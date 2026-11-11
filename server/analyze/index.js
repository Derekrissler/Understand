// Orchestrates a full analysis of a project folder.
import fs from 'node:fs/promises'
import path from 'node:path'
import { walkProject, readText, CODE_LANGS } from './walk.js'
import { extractJs, extractHtml, scriptBlocks, mergeInto } from './js.js'
import { runPyExtract, classifyPython } from './python.js'
import { extractJava } from './java.js'
import { Resolver, buildBindings, buildJavaIndex, resolveCalls } from './resolve.js'
import { segments, joinPaths, displayPath, matchRoute, suggestRoutes, fileRoutes } from './routes.js'
import { parseUrl, CATEGORIES, dbResource, fileResource, aiProvider } from './ops.js'
import { analyzeStack } from './stack.js'
import { buildFlow } from './flow.js'
import { analyzeHealth } from './health.js'
import { buildStory } from './story.js'

const P = path.posix

const emptyFacts = () => ({ imports: [], exports: [], functions: [], calls: [], http: [], routes: [], mounts: [], ops: [], consts: {}, env: [], ports: [], errors: [], pkgs: [] })

async function pool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

function notebookToPy(text) {
  const nb = JSON.parse(text)
  const cells = nb.cells || nb.worksheets?.[0]?.cells || []
  let out = ''
  cells.forEach((c, i) => {
    const src = Array.isArray(c.source) ? c.source.join('') : c.source || ''
    if (c.cell_type === 'code') out += `# %% [cell ${i + 1}]\n` + src.split('\n').map((l) => (/^\s*[%!]/.test(l) ? '# ' + l : l)).join('\n') + '\n\n'
    else if (c.cell_type === 'markdown') out += `# %% [markdown ${i + 1}]\n` + src.split('\n').map((l) => '# ' + l).join('\n') + '\n\n'
  })
  return out
}

const FRONTEND_PKGS = /^(react|react-dom|vue|svelte|preact|solid-js|@angular\/core|jquery|next|nuxt|@sveltejs\/kit|alpinejs|lit|three|chart\.js|leaflet)$/
const BACKEND_PKGS = /^(express|fastify|koa|hono|@nestjs\/core|flask|fastapi|django|starlette|aiohttp|tornado|socket\.io|ws|mongoose|pg|mysql2|sqlite3|better-sqlite3|@prisma\/client|sequelize|typeorm|knex|sqlalchemy|psycopg2|pymongo|nodemailer|stripe|jsonwebtoken|bcrypt|bcryptjs|passport|multer|uvicorn|gunicorn|celery)$/

function classifyRole(f, facts) {
  const p = f.path.toLowerCase()
  if (/(^|\/)(tests?|__tests__|__mocks__|spec|specs|e2e|cypress|fixtures)\//.test(p) || /\.(test|spec|e2e|stories)\.[a-z]+$/.test(p) || /(^|\/)test_[^/]+\.py$|_test\.(py|go)$/.test(p) || /src\/test\//.test(p)) return 'test'
  if (/(^|\/)[^/]*\.config\.[mc]?[jt]s$|(^|\/)(tsconfig|jsconfig|package|manifest)\.json$|(^|\/)\.[\w-]+rc(\.\w+)?$|(^|\/)(setup|conftest|manage|wsgi|asgi)\.py$|(^|\/)settings\.py$|(^|\/)gulpfile|(^|\/)gruntfile/.test(p)) return 'config'
  if (!CODE_LANGS.has(f.lang)) return 'other'
  let fe = 0, be = 0, sc = 0
  if (['html', 'css', 'scss', 'less', 'vue', 'svelte', 'astro'].includes(f.lang)) fe += 3
  if (/\.(jsx|tsx)$/.test(p)) fe += 2
  if (f.lang === 'java' || f.lang === 'kotlin') be += 3
  if (/(^|\/)(frontend|client|web|webapp|public|static|pages|components|views|ui|hooks|popup|content|extension|assets|styles|layouts|screens|app\/\(.*\))\//.test(p)) fe += 2
  if (/(^|\/)(server|backend|api|routes|routers|controllers?|services?|models?|middlewares?|db|database|repositories|handlers|resolvers|prisma)\//.test(p)) be += 2
  if (/(^|\/)(scripts?|scrapers?|crawlers?|pipelines?|etl|jobs|tasks|tools|bin|notebooks?|analysis|cli)\//.test(p)) sc += 2
  if (facts) {
    if (facts.routes?.length) be += 4
    for (const k of facts.pkgs || []) {
      if (FRONTEND_PKGS.test(k)) fe += 2
      if (BACKEND_PKGS.test(k)) be += 2
    }
    if (facts.ops?.some((o) => o.cat === 'dom' || o.cat === 'storage')) fe += 2
    if (facts.ops?.some((o) => o.cat === 'db' || o.cat === 'email' || o.cat === 'payments')) be += 1
    if (facts.lang === 'python') {
      if (facts.functions?.some((fn) => fn.qual === '<main>')) sc += 2
      if (facts.ops?.some((o) => o.cat === 'scrape' || o.cat === 'transform')) sc += 1
      sc += 1
    }
  }
  if (/\/pages\/api\//.test(p) || /\/app\/.*\/route\.[jt]s$/.test(p)) be += 5
  if (f.lang === 'notebook') sc += 4
  const best = Math.max(fe, be, sc)
  if (best === 0) return 'shared'
  if (be === best) return 'backend'
  if (fe === best) return 'frontend'
  return 'script'
}

export async function analyzeProject(root, { name, onProgress = () => {} } = {}) {
  const t0 = Date.now()
  let st
  try {
    st = await fs.stat(root)
  } catch {
    throw new Error(`Folder not found: ${root}`)
  }
  if (!st.isDirectory()) throw new Error(`Not a folder: ${root}`)
  onProgress('Scanning files')
  const { files, ignored, truncated } = await walkProject(root)
  if (!files.length) throw new Error(`No readable files in ${root}. It may be empty, fully git-ignored, or blocked by macOS privacy settings (Desktop/Documents need permission for your terminal).`)
  const texts = new Map()
  const virtual = new Map()
  onProgress(`Reading ${files.length} files`)
  await pool(files, 48, async (f) => {
    if (!f.lang || f.binary) return
    const t = await readText(f)
    if (t != null) {
      texts.set(f.path, t)
      f.loc = t.split('\n').length
    }
  })

  // ---------- extraction ----------
  onProgress('Parsing code')
  const fileFacts = new Map()
  const pyItems = []
  for (const f of files) {
    const code = texts.get(f.path)
    if (code == null) continue
    try {
      if (f.lang === 'javascript' || f.lang === 'typescript') fileFacts.set(f.path, { lang: 'js', ...extractJs(code, f.path) })
      else if (f.lang === 'vue' || f.lang === 'svelte' || f.lang === 'astro') {
        const out = emptyFacts()
        out.functions.push({ name: '<module>', qual: '<module>', line: 1, endLine: code.split('\n').length, kind: 'module', params: [] })
        const blocks = scriptBlocks(code)
        if (f.lang === 'astro') {
          const fm = code.match(/^---\n([\s\S]*?)\n---/)
          if (fm) blocks.push({ code: '\n' + fm[1], lang: 'ts' })
        }
        for (const b of blocks) if (!b.src) mergeInto(out, extractJs(b.code, f.path.replace(/\.\w+$/, b.lang === 'ts' ? '.tsx' : '.jsx'), { jsx: true }))
        for (const m of code.matchAll(/<([A-Z][\w]*)[\s/>]/g)) out.calls.push({ fn: '<module>', name: m[1], recv: null, text: m[1], line: code.slice(0, m.index).split('\n').length, jsx: true })
        fileFacts.set(f.path, { lang: 'js', ...out })
      } else if (f.lang === 'html') fileFacts.set(f.path, { lang: 'js', ...extractHtml(code, f.path) })
      else if (f.lang === 'python') pyItems.push({ path: f.path, code })
      else if (f.lang === 'notebook') {
        const py = notebookToPy(code)
        virtual.set(f.path, py)
        pyItems.push({ path: f.path, code: py })
      } else if (f.lang === 'java') fileFacts.set(f.path, { lang: 'java', ...extractJava(code, f.path) })
    } catch (e) {
      fileFacts.set(f.path, { lang: f.lang === 'java' ? 'java' : 'js', ...emptyFacts(), errors: [String(e?.message || e)] })
    }
  }
  if (pyItems.length) {
    onProgress(`Parsing ${pyItems.length} Python files`)
    const pyFacts = await runPyExtract(pyItems)
    for (const it of pyItems) {
      const facts = pyFacts[it.path]
      fileFacts.set(it.path, facts ? { lang: 'python', ...classifyPython(facts, it.path) } : { lang: 'python', ...emptyFacts(), errors: ['Python parser unavailable'] })
    }
  }

  // ---------- resolution ----------
  onProgress('Linking files and functions')
  const resolver = new Resolver(files, texts)
  const javaIndex = buildJavaIndex(fileFacts)
  const { bindings, edges: importEdges } = buildBindings(fileFacts, resolver, javaIndex)

  const functions = []
  for (const [file, facts] of fileFacts) {
    const seen = new Set()
    for (const fn of facts.functions) {
      let qual = fn.qual
      if (seen.has(qual)) {
        let i = 2
        while (seen.has(`${fn.qual}~${i}`)) i++
        qual = `${fn.qual}~${i}`
      }
      seen.add(qual)
      functions.push({ ...fn, qual, id: `${file}#${qual}`, file, lang: facts.lang, opIds: [], httpIds: [], routeIds: [], fields: facts.fields?.[fn.qual] || [] })
    }
  }
  const fnById = new Map(functions.map((f) => [f.id, f]))
  const { callEdges, fnIx, lookupExport, defaultLocal } = resolveCalls({ fileFacts, functions, bindings, javaIndex })
  const fnOf = (file, qual) => fnIx.get(file)?.byQual.get(qual) || fnIx.get(file)?.byQual.get('<module>')

  const fileRoles = new Map(files.map((f) => [f.path, classifyRole(f, fileFacts.get(f.path))]))

  // ---------- routes ----------
  const stackEarly = { contextPath: '' }
  for (const f of files) {
    if (/(^|\/)application(-\w+)?\.(properties|ya?ml)$/.test(f.path)) {
      const t = texts.get(f.path) || ''
      const ctx = t.match(/server\.servlet\.context-path\s*[=:]\s*(\S+)/)?.[1] || t.match(/context-path:\s*(\S+)/)?.[1]
      if (ctx) stackEarly.contextPath = ctx.replace(/["']/g, '')
    }
  }
  const mountEdges = []
  for (const [file, facts] of fileFacts) {
    for (const m of facts.mounts || []) {
      let target = null
      const b = m.ident ? bindings.get(file)?.get(m.ident) : null
      if (facts.lang === 'python') {
        if (m.module) {
          const r = resolver.resolvePy(file, m.module, 0)
          target = r?.file ? { file: r.file, recv: '*' } : null
        } else if (b?.module && m.member) target = { file: b.file, recv: m.member }
        else if (b?.file && !b.module) target = { file: b.file, recv: b.imported }
        else target = { file, recv: m.ident }
      } else if (m.source) {
        const r = resolver.resolveJs(file, m.source)
        target = r ? { file: r, recv: '*' } : null
      } else target = b?.file ? { file: b.file, recv: '*' } : { file, recv: m.ident }
      if (target) mountEdges.push({ parent: { file, recv: m.recv || '*' }, target, prefix: m.prefix, lang: facts.lang })
    }
  }
  const prefixFor = (file, recv, seen = new Set()) => {
    const k = `${file}::${recv}`
    if (seen.has(k)) return { prefix: '', mounted: false }
    seen.add(k)
    const e = mountEdges.find((m) => m.target.file === file && (m.target.recv === recv || m.target.recv === '*') && !(m.parent.file === file && m.parent.recv === recv))
    if (!e) return { prefix: '', mounted: false }
    const parent = prefixFor(e.parent.file, e.parent.recv, seen)
    return { prefix: joinPaths(parent.prefix, e.prefix ?? ''), mounted: true, override: e.prefix != null }
  }

  const routes = []
  const addRoute = (r) => {
    const p = displayPath(r.path)
    if (routes.some((x) => x.method === r.method && x.path === p && x.file === r.file && x.line === r.line)) return
    const lead = p.match(/^\/?\$\{[^}]+\}/)
    const route = { id: `r${routes.length + 1}`, ...r, path: p, segs: segments(lead ? p.slice(lead[0].length) : p), openPrefix: !!lead || undefined }
    routes.push(route)
    if (r.handlerId) fnById.get(r.handlerId)?.routeIds.push(route.id)
  }
  for (const [file, facts] of fileFacts) {
    if (facts.lang === 'js') {
      const nuxtHandler = (facts.calls || []).some((c) => c.name === 'defineEventHandler' || c.name === 'eventHandler')
      for (const fr of fileRoutes(file, (facts.exports || []).map((e) => e.name), { nuxtHandler })) {
        const h = lookupExport(file, fr.handlerExport) || (fr.handlerExport === 'default' ? fnIx.get(file)?.byQual.get(defaultLocal(file)) : null)
        addRoute({ method: fr.method, path: fr.path, file, line: h?.line || 1, framework: fr.framework, handlerId: h?.id || null })
      }
    }
    for (const r of facts.routes || []) {
      let full = r.path
      if (facts.lang === 'java') full = joinPaths(stackEarly.contextPath, r.path)
      else if (facts.lang === 'python') {
        const pre = prefixFor(file, r.framework === 'django' ? '*' : r.recv)
        const own = facts.routerPrefixes?.[r.recv] ?? ''
        full = joinPaths(pre.prefix, r.framework === 'flask' && pre.override ? '' : own, r.path)
      } else if (r.framework !== 'nest') full = joinPaths(prefixFor(file, r.recv).prefix, r.path)

      // handler
      const ix = fnIx.get(file)
      const h = r.handler || {}
      let handler = null
      if (h.inline) handler = ix?.byQual.get(h.inline)
      else if (h.fn) handler = ix?.byQual.get(h.fn)
      else if (h.method) handler = ix?.byQual.get(h.method)
      else if (h.ref) {
        const b = bindings.get(file)
        if (h.recv) {
          const rb = b?.get(h.recv)
          handler = rb?.file ? fnIx.get(rb.file)?.byQual.get(h.ref) || lookupExport(rb.file, h.ref) : ix?.byQual.get(`${h.recv}.${h.ref}`)
          if (!handler && h.classView && rb?.file) handler = fnIx.get(rb.file)?.byQual.get(`${h.ref}.get`)
        } else {
          handler = ix?.byQual.get(h.ref)
          const lb = b?.get(h.ref)
          if (!handler && lb?.file) handler = lookupExport(lb.file, lb.imported === 'default' ? 'default' : lb.imported) || fnIx.get(lb.file)?.byQual.get(h.ref)
        }
      } else if (h.classRef) {
        const lb = bindings.get(file)?.get(h.classRef)
        const cf = lb?.file || file
        let any = false
        for (const verb of ['get', 'post', 'put', 'patch', 'delete']) {
          const m = fnIx.get(cf)?.byQual.get(`${h.classRef}.${verb}`)
          if (m) { any = true; addRoute({ method: verb.toUpperCase(), path: full, file, line: r.line, framework: r.framework, handlerId: m.id }) }
        }
        if (any) continue
      }
      let approx = false
      if (!handler && r.fn && r.fn !== '<module>') { handler = ix?.byQual.get(r.fn); approx = !!handler }
      addRoute({ method: r.method, path: full, file, line: r.line, framework: r.framework, handlerId: handler?.id || null, handlerApprox: approx || undefined })
    }
  }

  // ---------- operations & resources ----------
  const ops = []
  const resources = new Map()
  const fileOpCats = new Map()
  const httpByFileIndex = new Map()
  const filePathSet = new Set(files.map((f) => f.path))
  for (const [file, facts] of fileFacts) {
    for (const o of facts.ops || []) {
      const fn = fnOf(file, o.fn)
      let resource = o.resource
      let label = o.label
      if (o.repoType) {
        const entity = javaIndex.classInfo.get(o.repoType)?.[0]?.info?.repositoryOf
        if (entity) resource = dbResource(entity, 'JPA')
      }
      // a helper's own path parameter (open(path)) is not a place; its callers' paths are (see below)
      const lead = o.cat === 'file' ? (o.target || '').match(/^\$\{(\w+)\}/) : null
      if (lead && fn && (fn.params || []).some((p) => p.name === lead[1])) resource = fileResource(null)
      // calls to LLM APIs over plain HTTP are AI calls
      let cat = o.cat
      if (o.cat === 'http' && resource?.kind === 'http' && aiProvider(resource.label)) {
        const prov = aiProvider(resource.label)
        label = `Calls ${prov} (${o.verb} ${resource.label})`
        cat = 'llm'
        resource = { kind: 'llm', key: `llm:${prov.toLowerCase()}`, label: prov }
      }
      if (o.cat === 'file' && resource && resource.key !== 'file:*') {
        const real = resolveFileTarget(o.target, file, filePathSet)
        if (real) {
          label = label.replace(resource.label, real)
          resource = { kind: 'file', key: `file:${real}`, label: real, exists: filePathSet.has(real) }
        }
      }
      const op = { id: ops.length, file, fnId: fn?.id || null, line: o.line, cat, verb: o.verb, label, target: o.target, lib: o.lib, rw: o.rw || null, sql: o.sql || null, resource: resource || null }
      if (o.httpIndex != null) httpByFileIndex.set(`${file}#${o.httpIndex}`, op.id)
      ops.push(op)
      fn?.opIds.push(op.id)
      const cats = fileOpCats.get(file) || {}
      cats[cat] = (cats[cat] || 0) + 1
      fileOpCats.set(file, cats)
      if (resource) {
        if (!resources.has(resource.key)) resources.set(resource.key, { ...resource, opIds: [], files: [], reads: 0, writes: 0 })
        const r = resources.get(resource.key)
        r.opIds.push(op.id)
        if (!r.files.includes(file)) r.files.push(file)
        if (o.rw === 'write') r.writes++
        else if (o.rw === 'read') r.reads++
      }
    }
  }

  // ---------- client calls ----------
  const routeIndex = routes.map((r) => ({ id: r.id, method: r.method, segs: r.segs, openPrefix: r.openPrefix }))
  const staticFiles = files.filter((f) => !fileFacts.has(f.path) || f.lang === 'json')
  const substitute = (url, file) => {
    if (!url) return url
    return url.replace(/\$\{([\w.]+)\}/g, (m, name) => {
      const [head, ...rest] = name.split('.')
      const b = bindings.get(file)?.get(head)
      if (!b?.file) return m
      const consts = fileFacts.get(b.file)?.consts || {}
      const keyName = rest.length ? (b.imported && !['default', '*'].includes(b.imported) ? `${b.imported}.${rest.join('.')}` : rest.join('.')) : b.imported
      const v = consts[keyName] ?? (rest.length && !b.module ? consts[`${defaultLocal(b.file)}.${rest.join('.')}`] : undefined)
      return typeof v === 'string' && !v.includes('${' + name + '}') ? v : m
    })
  }
  // Raw calls first, then push URLs through API wrappers: apiGet('/courses') -> fetch(`/api${path}`)
  const raw = []
  for (const [file, facts] of fileFacts) {
    ;(facts.http || []).forEach((h, i) => {
      const fn = fnOf(file, h.fn)
      raw.push({ file, fnId: fn?.id || null, line: h.line, method: h.method, methodParam: h.methodParam, url: h.url, lib: h.lib, opId: httpByFileIndex.get(`${file}#${i}`) ?? null })
    })
  }
  const paramNames = (fn) => {
    const names = (fn.params || []).map((p) => String(p.name).replace(/^\.\.\./, ''))
    return fn.lang === 'python' && fn.kind === 'method' && /^(self|cls)$/.test(names[0]) ? names.slice(1) : names
  }
  let frontier = raw.slice()
  for (let round = 0; round < 4 && frontier.length; round++) {
    const next = []
    for (const h of frontier) {
      const fn = fnById.get(h.fnId)
      if (!fn || fn.qual === '<module>') continue
      const params = paramNames(fn)
      const used = params.map((p, i) => [p, i]).filter(([p]) => h.url?.includes('${' + p + '}'))
      const methodIdx = h.methodParam ? params.indexOf(h.methodParam) : -1
      if (!used.length && methodIdx < 0) continue
      let derived = 0
      for (const callerId of fn.callers) {
        const caller = fnById.get(callerId)
        const callerParams = paramNames(caller)
        // only worth a new record when the call site adds a literal, or forwards its own parameter
        const useful = (v) => v != null && (!v.startsWith('${') || callerParams.includes(v.slice(2, -1)))
        for (const e of callEdges.get(callerId) || []) {
          if (e.to !== fn.id || e.jsx) continue
          const args = e.args || []
          const m = methodIdx >= 0 ? args[methodIdx] : null
          if (!used.some(([, i]) => useful(args[i])) && !useful(m)) continue
          let url = h.url
          for (const [p, i] of used) if (args[i] != null) url = url.split('${' + p + '}').join(args[i])
          const method = m && !m.startsWith('${') ? m.toUpperCase() : h.method
          const d = { file: caller.file, fnId: caller.id, line: e.line, method, methodParam: m?.startsWith('${') ? m.slice(2, -1) : null, url, lib: `via ${fn.name}()`, opId: null, viaFn: fn.id }
          raw.push(d)
          next.push(d)
          derived++
        }
      }
      if (derived) h.wrapper = derived
    }
    frontier = next
  }

  const genericTail = /\$\{(path|url|endpoint|route|uri|p|rest|resource|segment|suffix|target|href|link)\}/i
  const http = []
  for (const h of raw) {
    const file = h.file
    const fn = fnById.get(h.fnId)
    {
      const resolvedUrl = substitute(h.url, file)
      const parsed = parseUrl(resolvedUrl)
      if (h.viaFn && !h.wrapper && parsed.kind === 'dynamic') continue // a wrapper forwarding an unknown URL tells us nothing new
      const rec = { id: `h${http.length + 1}`, file, fnId: h.fnId, line: h.line, method: h.method, url: h.url, resolvedUrl, lib: h.lib, kind: parsed.kind, host: parsed.host || null, path: parsed.path || null, routeId: null, opId: h.opId, viaFn: h.viaFn || undefined }
      if (h.wrapper) {
        rec.kind = 'wrapper'
        rec.wrapperCalls = h.wrapper
      } else if (parsed.kind === 'internal' && genericTail.test(parsed.path)) {
        rec.kind = 'unresolved'
      } else if (parsed.kind === 'internal') {
        let best = matchRoute(routeIndex, h.method, parsed.path, { suffix: parsed.base != null || !!parsed.host?.includes('${') })
        // servers and dev proxies often strip a leading /api (or /v1, /backend) before routing
        const lead = parsed.path.match(/^\/(api|v\d|backend|server|rest)(?=\/)/i)
        if (!best && lead) {
          best = matchRoute(routeIndex, h.method, parsed.path.slice(lead[0].length))
          if (best) rec.viaPrefix = lead[0]
        }
        if (!best) {
          // last resort: exactly one route ends with this path (client base URL hidden at runtime)
          const segs = segments(parsed.path)
          if (segs.some((x) => x !== ':' && x !== '**')) {
            const tails = routeIndex.filter((r) => matchRoute([r], h.method, parsed.path, { suffix: true }))
            if (tails.length === 1) { best = { route: tails[0], partial: true }; rec.guess = true }
          }
        }
        if (best) {
          rec.kind = 'route'
          rec.routeId = best.route.id
          rec.partial = best.partial
        } else {
          const rel = parsed.path.replace(/^\/+/, '')
          const st = rel && /\.\w{2,5}$/.test(rel) ? staticFiles.find((x) => x.path === rel || x.path.endsWith('/' + rel)) : null
          if (st) { rec.kind = 'static'; rec.staticFile = st.path }
          else if (!routes.length || parsed.base != null) rec.kind = 'unresolved'
          else {
            rec.kind = 'unmatched'
            rec.suggestions = suggestRoutes(routeIndex, h.method, parsed.path)
          }
        }
      }
      if (rec.kind === 'external' && rec.opId == null && fn) {
        // a wrapper resolved to an outside service: record the call site as an operation of its own
        const prov = aiProvider(rec.host)
        const key = prov ? `llm:${prov.toLowerCase()}` : `http:${rec.host}`
        if (!resources.has(key)) resources.set(key, { kind: prov ? 'llm' : 'http', key, label: prov || rec.host, opIds: [], files: [], reads: 0, writes: 0 })
        const op = { id: ops.length, file, fnId: fn.id, line: h.line, cat: prov ? 'llm' : 'http', verb: rec.method, label: prov ? `Calls ${prov} (${h.lib})` : `${rec.method} ${rec.resolvedUrl.slice(0, 64)} (${h.lib})`, target: rec.resolvedUrl, lib: h.lib, rw: 'read', sql: null, resource: { kind: prov ? 'llm' : 'http', key, label: prov || rec.host } }
        ops.push(op)
        fn.opIds.push(op.id)
        rec.opId = op.id
        const r = resources.get(key)
        r.opIds.push(op.id)
        if (!r.files.includes(file)) r.files.push(file)
        const cats = fileOpCats.get(file) || {}
        cats[op.cat] = (cats[op.cat] || 0) + 1
        fileOpCats.set(file, cats)
      }
      if (rec.kind === 'dynamic' && rec.opId != null) {
        const op = ops[rec.opId]
        op.resource = { kind: 'http', key: 'http:(dynamic)', label: 'URLs built at runtime' }
        if (!resources.has(op.resource.key)) resources.set(op.resource.key, { ...op.resource, opIds: [], files: [], reads: 0, writes: 0 })
        const r = resources.get(op.resource.key)
        r.opIds.push(op.id)
        if (!r.files.includes(file)) r.files.push(file)
      }
      http.push(rec)
      fn?.httpIds.push(rec.id)
    }
  }
  for (const r of routes) r.callerIds = http.filter((h) => h.routeId === r.id).map((h) => h.id)

  // ---------- file paths passed into helpers ----------
  {
    const fileOps = ops.filter((o) => o.cat === 'file' && o.fnId && /\$\{/.test(o.target || ''))
    for (const o of fileOps) {
      const fn = fnById.get(o.fnId)
      if (!fn) continue
      const params = paramNames(fn)
      const used = params.map((p, i) => [p, i]).filter(([p]) => o.target.includes('${' + p + '}'))
      if (!used.length) continue
      for (const callerId of fn.callers) {
        const caller = fnById.get(callerId)
        for (const e of callEdges.get(callerId) || []) {
          if (e.to !== fn.id) continue
          const args = e.args || []
          if (!used.some(([, i]) => args[i] != null && !/^\$\{[^}]+\}$/.test(args[i]))) continue
          let target = o.target
          for (const [p, i] of used) if (args[i] != null) target = target.split('${' + p + '}').join(args[i])
          const real = resolveFileTarget(target, caller.file, filePathSet)
          const resource = real ? { kind: 'file', key: `file:${real}`, label: real, exists: filePathSet.has(real) } : fileResource(target)
          if (resource.key === 'file:*') continue
          const op = { id: ops.length, file: caller.file, fnId: caller.id, line: e.line, cat: 'file', verb: o.verb, label: `${o.rw === 'write' ? 'Writes' : 'Reads'} ${resource.label} (via ${fn.name}())`, target, lib: fn.name, rw: o.rw, sql: null, resource }
          ops.push(op)
          caller.opIds.push(op.id)
          if (!resources.has(resource.key)) resources.set(resource.key, { ...resource, opIds: [], files: [], reads: 0, writes: 0 })
          const r = resources.get(resource.key)
          r.opIds.push(op.id)
          if (!r.files.includes(caller.file)) r.files.push(caller.file)
          if (o.rw === 'write') r.writes++
          else r.reads++
          const cats = fileOpCats.get(caller.file) || {}
          cats.file = (cats.file || 0) + 1
          fileOpCats.set(caller.file, cats)
        }
      }
    }
  }

  // ---------- entry points ----------
  const entries = new Map()
  for (const fn of functions) {
    if (fn.qual === '<main>') entries.set(fn.file, 'Runs as a script (__main__)')
    if (fn.kind === 'main' && fn.lang === 'java') entries.set(fn.file, 'Java main()')
  }
  for (const [file, facts] of fileFacts) {
    if (facts.lang === 'java' && facts.classes?.some((c) => c.springApp)) entries.set(file, 'Spring Boot application')
    if (facts.ports?.length && facts.lang === 'js') entries.set(file, 'Starts the server')
  }
  for (const f of files) {
    if (f.lang === 'notebook') entries.set(f.path, 'Jupyter notebook')
    if (f.lang === 'html') entries.set(f.path, 'HTML page')
    const base = P.basename(f.path)
    const dir = P.dirname(f.path) === '.' ? '' : P.dirname(f.path)
    const t = texts.get(f.path)
    if (!t) continue
    if (base === 'package.json') {
      try {
        const pj = JSON.parse(t)
        for (const [k, v] of Object.entries(pj.scripts || {})) {
          for (const tok of String(v).split(/\s+/)) {
            if (/\.(m|c)?[jt]sx?$|\.py$/.test(tok)) {
              const target = P.normalize(P.join(dir, tok))
              if (fileFacts.has(target)) entries.set(target, `npm script "${k}"`)
            }
          }
        }
        for (const m of [pj.main, ...(typeof pj.bin === 'string' ? [pj.bin] : Object.values(pj.bin || {}))].filter(Boolean)) {
          const target = resolver.tryJs(P.normalize(P.join(dir, m)))
          if (target) entries.set(target, 'package entry (main/bin)')
        }
      } catch {}
    }
    if (base === 'manifest.json' && /"manifest_version"/.test(t)) {
      for (const m of t.matchAll(/"([^"]+\.(?:js|html))"/g)) {
        const target = P.normalize(P.join(dir, m[1]))
        if (fileFacts.has(target)) entries.set(target, 'browser extension script')
      }
    }
    if (/^(Dockerfile|Procfile)/.test(base)) {
      for (const m of t.matchAll(/([\w./-]+\.(?:py|js|mjs|ts))/g)) {
        const target = P.normalize(P.join(dir, m[1]))
        if (fileFacts.has(target)) entries.set(target, `${base} command`)
      }
    }
  }

  // ---------- graph-derived file info ----------
  const importedBy = new Map()
  for (const [a, set] of importEdges) for (const b of set) {
    if (!importedBy.has(b)) importedBy.set(b, [])
    importedBy.get(b).push(a)
  }
  // call edges between files also count as "used"
  for (const fn of functions) for (const c of fn.callees) {
    const t = fnById.get(c)
    if (t && t.file !== fn.file) {
      if (!importedBy.has(t.file)) importedBy.set(t.file, [])
      if (!importedBy.get(t.file).includes(fn.file)) importedBy.get(t.file).push(fn.file)
    }
  }

  // ---------- runnable ----------
  const fileCtx = new Map()
  for (const [file, facts] of fileFacts) {
    fileCtx.set(file, {
      hasMain: facts.functions.some((f) => f.qual === '<main>'),
      isServer: !!(facts.ports?.length || facts.routes?.length || facts.mounts?.length || (facts.calls || []).some((c) => /^(listen|createServer|serve_forever|runserver)$/.test(c.name) || /^(uvicorn|waitress|gunicorn|Bun|Deno|socketio|app)\.(run|serve)$/.test(c.text))),
      importedBy: (importedBy.get(file) || []).length,
    })
  }
  for (const fn of functions) fn.runnable = runnableInfo(fn, fileRoles.get(fn.file), entries.has(fn.file), fileCtx.get(fn.file) || {})

  onProgress('Building the workflow map')
  const flow = buildFlow({ functions, fnById, callEdges, routes, http, ops, resources, fileRoles, entries, fileOpCats })

  let gitignoreText = ''
  try { gitignoreText = await fs.readFile(path.join(root, '.gitignore'), 'utf8') } catch {}
  const stack = analyzeStack({ files, texts, fileFacts, fileRoles })
  const health = analyzeHealth({ files, texts, fileFacts, fileRoles, functions, routes, http, entries, importedBy, stack, gitignoreText, virtual })
  const insights = rankFunctions(functions, fileRoles, entries, ops)
  let story
  try {
    story = buildStory({ name: name || path.basename(root), functions, fnById, callEdges, ops, http, routes, resources, fileRoles, entries, texts, stack, health, virtual })
  } catch (e) {
    console.error('[understand] story failed:', e)
    story = { summary: 'Could not build the overview for this project.', stages: [], talking: [], caveats: [], sidePaths: [], builtWith: [], proof: null, stageOfFn: {} }
  }

  // ---------- assemble ----------
  const fileList = files.map((f) => {
    const facts = fileFacts.get(f.path)
    return {
      path: f.path, lang: f.lang, size: f.size, loc: f.loc || 0, role: fileRoles.get(f.path), binary: f.binary || undefined,
      imports: [...(importEdges.get(f.path) || [])], importedBy: importedBy.get(f.path) || [],
      externalImports: facts ? [...new Set((facts.pkgs || []))].slice(0, 40) : [],
      entry: entries.get(f.path) || null, ops: fileOpCats.get(f.path) || {}, parseError: facts?.errors?.[0] || null,
      virtual: virtual.has(f.path) || undefined,
    }
  })
  const fnOut = functions.map((f) => ({
    id: f.id, file: f.file, qual: f.qual, name: f.name, kind: f.kind, lang: f.lang, line: f.line, endLine: f.endLine, defLine: f.defLine,
    params: f.params || [], doc: f.doc || null, exported: f.exported || null, async: f.async || false, className: f.className || null,
    decorators: f.decorators?.map((d) => d.text) || f.annotations || undefined, returns: f.returns || undefined,
    callees: f.callees, callers: f.callers, opIds: f.opIds, httpIds: f.httpIds, routeIds: f.routeIds, runnable: f.runnable,
    calls: (callEdges.get(f.id) || []).map((e) => [e.to, e.line]),
    fields: f.fields.length ? f.fields : undefined,
  }))

  return {
    model: {
      name: name || path.basename(root),
      root,
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      truncated,
      ignored,
      totals: {
        files: files.length, codeFiles: fileFacts.size, loc: files.reduce((s, f) => s + (fileFacts.has(f.path) ? f.loc || 0 : 0), 0),
        functions: functions.filter((f) => f.qual !== '<module>').length, routes: routes.length, calls: http.length, ops: ops.length,
      },
      categories: CATEGORIES,
      files: fileList,
      functions: fnOut,
      routes: routes.map(({ segs, ...r }) => r),
      http,
      ops,
      resources: [...resources.values()],
      flow,
      stack,
      health,
      insights,
      story,
    },
    internal: { callEdges, virtual, root },
  }
}

/**
 * Turn a file-path expression into a project path when we can:
 * `${__dirname}/../data/x.json`, `${Path().parent}/sample.html`, or a relative path that exists.
 */
function resolveFileTarget(raw, file, filePaths) {
  if (!raw || raw === '(dynamic path)') return null
  let s = String(raw).replace(/\\/g, '/')
  let base = null
  const m = s.match(/^\$\{([^}]*)\}\/?/)
  if (m) {
    if (!/__dirname|__file__|Path\(\)|dirname|import\.meta|BASE_DIR|HERE|ROOT_DIR|CURRENT_DIR|SCRIPT_DIR|^(ROOT|BASE|BASEDIR|PROJECT_ROOT|APP_ROOT|ROOT_PATH)$/i.test(m[1])) return null
    base = P.dirname(file)
    const ups = (m[1].match(/\.parent/g) || []).length
    for (let i = 1; i < ups; i++) base = P.dirname(base)
    if (base === '.') base = ''
    s = s.slice(m[0].length)
  }
  s = s.replace(/\.(tmp|temp|part|new|bak)$|~$/i, '') // atomic writes: data.json.tmp -> data.json
  if (!s || s.startsWith('/') || s.includes('${')) return null
  const candidates = base !== null ? [P.normalize(P.join(base, s))] : [P.normalize(s), P.normalize(P.join(P.dirname(file), s))]
  for (const c of candidates) if (!c.startsWith('..') && filePaths.has(c)) return c
  const tail = P.normalize(s).replace(/^(\.\.\/)+/, '')
  for (const p of filePaths) if (p === tail || p.endsWith('/' + tail)) return p
  return base !== null && !candidates[0].startsWith('..') ? candidates[0] : null
}

function runnableInfo(fn, role, isEntry, ctx = {}) {
  if (/\.ipynb$/.test(fn.file)) return { ok: false, reason: 'Notebook cell code: run it in Jupyter.' }
  if (fn.lang === 'java') return { ok: false, reason: 'Java runs inside the compiled app: test it through its HTTP routes (Live tap / Send request).' }
  if (fn.kind === 'handler') return { ok: false, reason: 'Route handler: send a real request to its route instead (Live tap → Send request).' }
  if (fn.kind === 'component') return { ok: false, reason: 'UI component: it renders in the browser, so test it in the running app.' }
  const server = { ok: false, reason: 'This file starts a server, which would keep running until the timeout. Start the app yourself and use the Live tap to test its routes.' }
  if (fn.qual === '<main>') return ctx.isServer ? server : { ok: true, mode: 'script', lang: fn.lang, note: 'Runs the whole script like `python file.py`.' }
  if (fn.qual === '<module>') {
    if (ctx.isServer) return server
    if (fn.lang === 'python' && !ctx.hasMain && !ctx.importedBy && (fn.opIds.length || fn.callees.length)) return { ok: true, mode: 'script', lang: 'python', note: 'This script does its work at top level: runs it like `python file.py`.' }
    if (fn.lang === 'js' && isEntry && role !== 'frontend') return { ok: true, mode: 'script', lang: 'js', note: 'Runs the file with Node, like `node file`.' }
    return { ok: false, reason: 'Module-level code runs when the file is imported.' }
  }
  if (fn.lang === 'python') {
    if (fn.kind === 'function') return { ok: true, mode: 'function', lang: 'python' }
    if (fn.kind === 'method') return { ok: true, mode: 'method', lang: 'python', note: 'Methods run on a fresh instance (constructor called with no arguments) unless static.' }
  }
  if (fn.lang === 'js') {
    if (!fn.exported) return { ok: false, reason: 'Not exported, so it cannot be imported on its own. Export it, or run an exported caller.' }
    if (role === 'frontend' && fn.kind === 'hook') return { ok: false, reason: 'React hook: only runs inside a component.' }
    return { ok: true, mode: String(fn.exported).endsWith('#') ? 'method' : 'function', lang: 'js', note: role === 'frontend' ? 'Frontend code: anything using window/document will fail under Node.' : undefined }
  }
  return { ok: false, reason: 'Not runnable' }
}

function rankFunctions(functions, roles, entries, ops) {
  const byId = new Map(functions.map((f) => [f.id, f]))
  const reachCats = (f) => {
    const out = new Set()
    const seen = new Set([f.id])
    let frontier = f.callees
    for (let d = 0; d < 3 && frontier.length; d++) {
      const next = []
      for (const id of frontier) {
        if (seen.has(id)) continue
        seen.add(id)
        const g = byId.get(id)
        if (!g) continue
        for (const o of g.opIds) out.add(ops[o].cat)
        next.push(...g.callees)
      }
      frontier = next
    }
    return out
  }
  const WEIGHT = { dom: 0.75, storage: 0.5, transform: 1.5, auth: 1.5 }
  const scored = []
  for (const f of functions) {
    if (f.kind === 'repository' || roles.get(f.file) === 'test') continue
    if (f.qual === '<module>' && !(entries.has(f.file) && f.opIds.length)) continue
    const cats = new Set(f.opIds.map((i) => ops[i].cat))
    const reached = [...reachCats(f)].filter((c) => !cats.has(c))
    const reasons = []
    let s = 0
    if (f.routeIds.length) { s += 4; reasons.push(`handles ${f.routeIds.length} route${f.routeIds.length > 1 ? 's' : ''}`) }
    if (cats.size) { for (const c of cats) s += 2 * (WEIGHT[c] ?? 1); reasons.push([...cats].join(', ')) }
    if (reached.length) { s += reached.length; reasons.push(`leads to ${reached.join(', ')}`) }
    if (f.callers.length) { s += 1.5 * Math.log2(1 + f.callers.length); if (f.callers.length >= 3) reasons.push(`called from ${f.callers.length} places`) }
    if (f.callees.length) s += Math.log2(1 + f.callees.length)
    if (f.qual === '<main>' || f.kind === 'main') { s += 3; reasons.push('script entry point') }
    if (f.httpIds.length) s += 1
    if (f.endLine - f.line < 2) s -= 2
    if (s > 2) scored.push({ fnId: f.id, score: Math.round(s * 10) / 10, reasons })
  }
  scored.sort((a, b) => b.score - a.score)
  return { readFirst: scored.slice(0, 15) }
}
