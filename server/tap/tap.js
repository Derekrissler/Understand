// Live tap: a recording reverse proxy. Point your frontend (or browser) at the tap port
// instead of the backend and every request/response is captured, matched to a route,
// and streamed to the UI.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { matchRoute } from '../analyze/routes.js'
import { segments } from '../analyze/routes.js'

const BODY_CAP = 2 * 1024 * 1024
const KEEP = 500
const SENSITIVE = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization)$/i
const ASSET = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|mp4|webm)$|^\/(@vite|@fs|@id|@react-refresh|node_modules|src)\/|^\/__vite|hot-update|^\/favicon/i

const maskHeaders = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, SENSITIVE.test(k) ? maskValue(String(v)) : v]))
function maskValue(v) {
  if (v.length <= 12) return '••••'
  return `${v.slice(0, 10)}…(${v.length} chars)`
}

function decodeBody(buf, contentType, truncated) {
  if (!buf.length) return { kind: 'empty' }
  const ct = (contentType || '').toLowerCase()
  const textual = /json|text|xml|javascript|x-www-form-urlencoded|graphql|csv|event-stream/.test(ct) || !ct
  if (!textual) return { kind: 'binary', size: buf.length, contentType: ct }
  const text = buf.toString('utf8')
  if (/json/.test(ct) || (!ct && /^\s*[[{]/.test(text))) {
    try {
      return { kind: 'json', json: JSON.parse(text), size: buf.length }
    } catch {}
  }
  if (/x-www-form-urlencoded/.test(ct)) return { kind: 'form', json: Object.fromEntries(new URLSearchParams(text)), size: buf.length }
  return { kind: 'text', text: text.slice(0, 200000), size: buf.length, truncated }
}

export class Tap {
  constructor() {
    this.server = null
    this.target = null
    this.port = null
    this.exchanges = []
    this.listeners = new Set()
    this.seq = 0
    this.routes = []
    this.projectId = null
  }

  status() {
    return { running: !!this.server, target: this.target, port: this.port, projectId: this.projectId, count: this.exchanges.length }
  }

  setRoutes(projectId, routes) {
    this.projectId = projectId
    this.routes = (routes || []).map((r) => ({ id: r.id, method: r.method, segs: segments(r.path.replace(/^\/?\$\{[^}]+\}/, '')), openPrefix: /^\/?\$\{/.test(r.path) }))
  }

  match(method, pathname) {
    let best = matchRoute(this.routes, method, pathname)
    if (!best) {
      const lead = pathname.match(/^\/(api|v\d|backend|server|rest)(?=\/)/i)
      if (lead) best = matchRoute(this.routes, method, pathname.slice(lead[0].length))
    }
    return best?.route.id || null
  }

  emit(type, data) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
    for (const l of this.listeners) l.write(msg)
  }

  record(ex) {
    this.exchanges.push(ex)
    if (this.exchanges.length > KEEP) this.exchanges.shift()
    this.emit('exchange', ex)
  }

  clear() {
    this.exchanges = []
    this.emit('clear', {})
  }

  async start({ target, port = 4999 }) {
    await this.stop()
    const t = new URL(target)
    if (!/^https?:$/.test(t.protocol)) throw new Error('Target must be an http(s) URL')
    this.target = t.origin
    this.port = Number(port)
    const lib = t.protocol === 'https:' ? https : http
    const server = http.createServer((req, res) => {
      const id = `x${++this.seq}`
      const started = Date.now()
      const url = new URL(req.url, t.origin)
      const reqChunks = []
      let reqSize = 0
      const headers = { ...req.headers, host: t.host }
      delete headers['accept-encoding'] // ask for plain bodies so they can be shown
      const upstream = lib.request(url, { method: req.method, headers, rejectUnauthorized: false }, (up) => {
        const outHeaders = { ...up.headers }
        if (outHeaders.location) outHeaders.location = String(outHeaders.location).replace(t.origin, `http://localhost:${this.port}`)
        res.writeHead(up.statusCode || 502, up.statusMessage, outHeaders)
        const resChunks = []
        let resSize = 0
        up.on('data', (c) => {
          if (resSize < BODY_CAP) resChunks.push(c)
          resSize += c.length
          res.write(c)
        })
        up.on('end', () => {
          res.end()
          this.finish({ id, started, req, url, reqChunks, reqSize, up, resChunks, resSize })
        })
        up.on('error', () => res.end())
      })
      upstream.on('error', (e) => {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
        res.end(`Understand tap: could not reach ${t.origin} (${e.code || e.message}). Is your backend running?`)
        this.record({ id, at: new Date(started).toISOString(), method: req.method, path: url.pathname, query: url.search, status: 502, ms: Date.now() - started, error: `upstream unreachable: ${e.code || e.message}`, routeId: this.match(req.method, url.pathname), asset: ASSET.test(url.pathname), source: 'tap' })
      })
      req.on('data', (c) => {
        if (reqSize < BODY_CAP) reqChunks.push(c)
        reqSize += c.length
        upstream.write(c)
      })
      req.on('end', () => upstream.end())
      req.on('error', () => upstream.destroy())
    })
    server.on('upgrade', (req, socket, head) => {
      // WebSocket passthrough (dev-server HMR, socket.io); not recorded
      const up = net.connect(Number(t.port) || (t.protocol === 'https:' ? 443 : 80), t.hostname, () => {
        const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
        for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${/^host$/i.test(req.rawHeaders[i]) ? t.host : req.rawHeaders[i + 1]}`)
        up.write(lines.join('\r\n') + '\r\n\r\n')
        if (head?.length) up.write(head)
        socket.pipe(up).pipe(socket)
      })
      up.on('error', () => socket.destroy())
      socket.on('error', () => up.destroy())
    })
    await new Promise((resolve, reject) => {
      server.once('error', (e) => reject(new Error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use; pick another tap port.` : e.message)))
      server.listen(this.port, '127.0.0.1', resolve)
    })
    this.server = server
    this.emit('status', this.status())
    return this.status()
  }

  finish({ id, started, req, url, reqChunks, reqSize, up, resChunks, resSize }) {
    const reqBuf = Buffer.concat(reqChunks)
    const resBuf = Buffer.concat(resChunks)
    this.record({
      id, at: new Date(started).toISOString(), ms: Date.now() - started, source: 'tap',
      method: req.method, path: url.pathname, query: url.search, status: up.statusCode,
      routeId: this.match(req.method, url.pathname), asset: ASSET.test(url.pathname),
      request: { headers: maskHeaders(req.headers), body: decodeBody(reqBuf, req.headers['content-type'], reqSize > BODY_CAP), size: reqSize },
      response: { headers: maskHeaders(up.headers), body: decodeBody(resBuf, up.headers['content-type'], resSize > BODY_CAP), size: resSize },
    })
  }

  async stop() {
    if (!this.server) return this.status()
    const s = this.server
    this.server = null
    s.closeAllConnections?.()
    await new Promise((r) => s.close(() => r()))
    this.emit('status', this.status())
    return this.status()
  }

  /** "Send request": fire one request at the target (or any local URL) and record it like tapped traffic. */
  async probe({ method = 'GET', url, headers = {}, body }) {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs can be probed')
    const id = `p${++this.seq}`
    const started = Date.now()
    const init = { method, headers: { ...headers }, redirect: 'manual' }
    if (body != null && body !== '' && !/^(GET|HEAD)$/i.test(method)) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
      if (!Object.keys(init.headers).some((k) => k.toLowerCase() === 'content-type')) init.headers['content-type'] = 'application/json'
    }
    let ex
    try {
      const r = await fetch(u, { ...init, signal: AbortSignal.timeout(60000) })
      const buf = Buffer.from(await r.arrayBuffer())
      ex = {
        id, at: new Date(started).toISOString(), ms: Date.now() - started, source: 'probe', method: method.toUpperCase(), path: u.pathname, query: u.search,
        status: r.status, routeId: this.match(method.toUpperCase(), u.pathname), asset: false, origin: u.origin,
        request: { headers: maskHeaders(init.headers), body: decodeBody(Buffer.from(init.body || ''), init.headers['content-type'], false), size: (init.body || '').length },
        response: { headers: maskHeaders(Object.fromEntries(r.headers)), body: decodeBody(buf.subarray(0, BODY_CAP), r.headers.get('content-type'), buf.length > BODY_CAP), size: buf.length },
      }
    } catch (e) {
      ex = { id, at: new Date(started).toISOString(), ms: Date.now() - started, source: 'probe', method: method.toUpperCase(), path: u.pathname, query: u.search, status: 0, routeId: this.match(method.toUpperCase(), u.pathname), error: `${e.cause?.code || e.name}: ${e.cause?.message || e.message}`, origin: u.origin }
    }
    this.record(ex)
    return ex
  }
}
