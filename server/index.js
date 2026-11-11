// Understand: local server. Binds to 127.0.0.1 only, because it can run code from the
// projects it analyses.
import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Workspace } from './workspace.js'
import { Runner } from './run/runner.js'
import { Tap } from './tap/tap.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PORT = Number(process.env.PORT || 4800)
const DIST = path.join(ROOT, 'web', 'dist')

const workspace = new Workspace(path.join(ROOT, '.workspaces'))
const runner = new Runner()
const tap = new Tap()
const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 400 } })

// ---- security: localhost only, and every state-changing call must carry a custom header.
// A custom header forces a CORS preflight, which we never approve, so other websites open
// in your browser cannot trigger code execution here. The Host check blocks DNS rebinding.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
app.use((req, res, next) => {
  if (!LOCAL.test(req.headers.host || '')) return res.status(403).send('Understand only accepts requests addressed to localhost')
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return res.status(403).json({ error: 'Cross-origin request refused' })
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-understand'] !== '1') return res.status(403).json({ error: 'Missing X-Understand header' })
  next()
})
app.use(express.json({ limit: '60mb' }))

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[understand]', e)
  res.status(e.status || 400).json({ error: e.message || String(e) })
})
const need = async (req) => {
  const p = await workspace.get(req.params.id)
  if (!p) throw Object.assign(new Error('Project not found. Open it again from the home page.'), { status: 404 })
  return p
}

// ---- projects ----
app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.1.0', demoPath: path.join(ROOT, 'examples', 'listings-pipeline'), cwd: process.cwd() }))
app.get('/api/projects', wrap(async (req, res) => res.json({ recent: await workspace.recent(), loaded: [...workspace.projects.keys()] })))
app.post('/api/projects/open', wrap(async (req, res) => {
  const p = await workspace.open(String(req.body.path || ''), { name: req.body.name })
  res.json({ id: p.id, name: p.model.name })
}))
app.get('/api/projects/:id', wrap(async (req, res) => {
  const p = await need(req)
  res.json(p.model)
}))
app.post('/api/projects/:id/reanalyze', wrap(async (req, res) => {
  const p = await workspace.reanalyze(req.params.id)
  if (tap.projectId === p.id) tap.setRoutes(p.id, p.model.routes)
  res.json({ id: p.id })
}))
app.post('/api/uploads', wrap(async (req, res) => res.json(await workspace.startUpload(req.body.name))))
app.post('/api/uploads/:uploadId/files', upload.array('files'), wrap(async (req, res) => {
  for (const f of req.files || []) await workspace.addUploadFile(req.params.uploadId, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.buffer)
  res.json({ ok: true, count: (req.files || []).length })
}))
app.post('/api/uploads/:uploadId/finish', wrap(async (req, res) => {
  const p = await workspace.finishUpload(req.params.uploadId)
  res.json({ id: p.id, name: p.model.name })
}))

app.get('/api/projects/:id/file', wrap(async (req, res) => {
  const p = await need(req)
  const rel = String(req.query.path || '')
  const meta = p.model.files.find((f) => f.path === rel)
  if (!meta) throw Object.assign(new Error('File is not part of this project'), { status: 404 })
  if (meta.binary) return res.json({ path: rel, lang: meta.lang, binary: true, size: meta.size })
  let content = p.internal.virtual.get(rel)
  if (content == null) {
    if (meta.size > 3_000_000) return res.json({ path: rel, lang: meta.lang, tooLarge: true, size: meta.size })
    content = await fsp.readFile(path.join(p.root, rel), 'utf8')
  }
  // never show secret values from env files
  if (/(^|\/)\.env/.test(rel)) content = content.replace(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.+)$/gm, (m, k, v) => `${k}${v.trim() ? '••••••  (value hidden)' : ''}`)
  res.json({ path: rel, lang: meta.virtual ? 'python' : meta.lang, content, size: meta.size, virtual: !!meta.virtual })
}))
app.get('/api/projects/:id/trace', wrap(async (req, res) => {
  const p = await need(req)
  const t = p.trace(String(req.query.node || ''))
  if (!t) throw Object.assign(new Error('Nothing to trace for that node'), { status: 404 })
  res.json(t)
}))

// ---- running code ----
app.get('/api/projects/:id/run-defaults', wrap(async (req, res) => {
  const p = await need(req)
  const fn = p.model.functions.find((f) => f.id === req.query.fn)
  if (!fn) throw new Error('Unknown function')
  res.json(runner.defaults(p, fn))
}))
app.post('/api/projects/:id/run', wrap(async (req, res) => {
  const p = await need(req)
  const fn = p.model.functions.find((f) => f.id === req.body.fnId)
  if (!fn) throw new Error('Unknown function')
  const timeoutMs = Math.min(Math.max(Number(req.body.timeoutMs) || 30000, 1000), 600000)
  res.json(await runner.run(p, fn, { args: req.body.args || [], kwargs: req.body.kwargs || {}, timeoutMs, useEnv: req.body.useEnv !== false, cwd: req.body.cwd, argv: req.body.argv || [] }))
}))
app.get('/api/projects/:id/runs', wrap(async (req, res) => res.json(runner.list(req.params.id))))
app.get('/api/runs/:runId', wrap(async (req, res) => {
  const s = runner.summary(req.params.runId)
  if (!s) throw Object.assign(new Error('Run not found'), { status: 404 })
  res.json(s)
}))
app.get('/api/runs/:runId/value', wrap(async (req, res) => {
  const r = runner.runs.get(req.params.runId)
  if (!r) throw Object.assign(new Error('Run not found'), { status: 404 })
  res.setHeader('content-disposition', `attachment; filename="${r.label.replace(/[^\w.-]+/g, '_')}-${r.id}.json"`)
  res.json(r.value)
}))

// ---- live tap ----
app.get('/api/tap', (req, res) => res.json({ ...tap.status(), exchanges: tap.exchanges }))
app.post('/api/tap/start', wrap(async (req, res) => {
  const p = req.body.projectId ? await workspace.get(req.body.projectId) : null
  if (p) tap.setRoutes(p.id, p.model.routes)
  res.json(await tap.start({ target: String(req.body.target || ''), port: req.body.port || 4999 }))
}))
app.post('/api/tap/stop', wrap(async (req, res) => res.json(await tap.stop())))
app.post('/api/tap/clear', wrap(async (req, res) => { tap.clear(); res.json({ ok: true }) }))
app.post('/api/tap/probe', wrap(async (req, res) => {
  const p = req.body.projectId ? await workspace.get(req.body.projectId) : null
  if (p && tap.projectId !== p.id) tap.setRoutes(p.id, p.model.routes)
  res.json(await tap.probe(req.body))
}))
app.get('/api/tap/events', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.write(`event: status\ndata: ${JSON.stringify(tap.status())}\n\n`)
  tap.listeners.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 20000)
  req.on('close', () => {
    clearInterval(ping)
    tap.listeners.delete(res)
  })
})

// ---- UI ----
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api/') ? res.sendFile(path.join(DIST, 'index.html')) : next()))
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }))

app.listen(PORT, '127.0.0.1', async () => {
  const base = process.env.UNDERSTAND_UI || `http://localhost:${PORT}`
  console.log(`\n  Understand is running at ${base}\n`)
  const target = process.argv[2]
  let url = base
  if (target) {
    try {
      const p = await workspace.open(target)
      url = `${base}/#/p/${p.id}/pipeline`
      console.log(`  Analysed ${p.model.name}: ${url}\n`)
    } catch (e) {
      console.error(`  Could not analyse ${target}: ${e.message}`)
    }
  }
  if (process.env.UNDERSTAND_OPEN === '1' && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
})
