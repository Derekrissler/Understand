// Builds the workflow graph shown in the Flow view.
// Lanes: entry (pages, scripts) -> api (routes) -> logic (files doing the work) -> data (stores & services)
import path from 'node:path'
import { segments } from './routes.js'

const P = path.posix
const MAX_DEPTH = 7

export function buildFlow({ functions, fnById, callEdges, routes, http, ops, resources, fileRoles, entries, fileOpCats }) {
  const nodes = new Map()
  const edges = new Map()
  const handlerFiles = new Set()

  const addNode = (id, data) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...data })
    return nodes.get(id)
  }
  const addEdge = (source, target, kind, ref, label) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return
    const id = `${source}->${target}:${kind}`
    if (!edges.has(id)) edges.set(id, { id, source, target, kind, label: label || null, count: 0, refs: [] })
    const e = edges.get(id)
    e.count++
    if (ref && e.refs.length < 12) e.refs.push(ref)
  }
  const group = (p) => P.dirname(p).split('/').slice(0, 2).join('/')
  const fileNode = (p, lane) => {
    const n = addNode(`file:${p}`, { type: 'file', lane, path: p, label: P.basename(p), sub: P.dirname(p) === '.' ? '' : P.dirname(p), role: fileRoles.get(p), group: group(p), ops: fileOpCats.get(p) || {}, entry: entries.get(p) || null })
    return n
  }
  const isTest = (p) => fileRoles.get(p) === 'test'
  const resNode = (r) => addNode(`res:${r.key}`, { type: 'resource', lane: 'data', key: r.key, kind: r.kind, label: r.label, engine: r.engine || null, reads: r.reads, writes: r.writes, group: r.kind })

  // 1. routes
  for (const r of routes) {
    addNode(`route:${r.id}`, { type: 'route', lane: 'api', routeId: r.id, method: r.method, label: `${r.method} ${r.path}`, path: r.path, file: r.file, framework: r.framework, group: segments(r.path).slice(0, 2).join('/') })
  }

  // 2. client calls
  for (const h of http) {
    if (isTest(h.file)) continue
    const lane = fileRoles.get(h.file) === 'backend' ? 'logic' : 'entry'
    const ref = { file: h.file, line: h.line, fnId: h.fnId, httpId: h.id }
    if (h.kind === 'route') {
      fileNode(h.file, lane)
      addEdge(`file:${h.file}`, `route:${h.routeId}`, 'calls', ref, h.method)
    } else if (h.kind === 'unmatched' || h.kind === 'unresolved') {
      fileNode(h.file, lane)
      const key = `call:${h.kind}:${h.method} ${segments(h.path || '').join('/')}`
      addNode(key, { type: 'call', lane: 'api', status: h.kind, method: h.method, label: `${h.method} ${h.path || '?'}`, path: h.path, httpIds: [], group: 'zz-unmatched' }).httpIds.push(h.id)
      addEdge(`file:${h.file}`, key, 'calls', ref, h.method)
    } else if (h.kind === 'external' && h.opId == null && resources.has(`http:${h.host}`)) {
      fileNode(h.file, lane)
      const r = resources.get(`http:${h.host}`)
      resNode(r)
      addEdge(`file:${h.file}`, `res:${r.key}`, 'uses', ref)
    } else if (h.kind === 'static') {
      fileNode(h.file, lane)
      const r = resources.get(`file:${h.staticFile}`) || { key: `file:${h.staticFile}`, kind: 'file', label: h.staticFile }
      resNode(r)
      addEdge(`file:${h.file}`, `res:${r.key}`, 'reads', ref)
    }
  }

  // 3. walk the call graph from a set of start functions
  const walk = (startIds) => {
    const seen = new Set(startIds)
    const q = startIds.map((id) => [id, 0])
    while (q.length) {
      const [id, d] = q.shift()
      const fn = fnById.get(id)
      if (!fn) continue
      if (!nodes.has(`file:${fn.file}`)) fileNode(fn.file, 'logic')
      for (const oid of fn.opIds) {
        const op = ops[oid]
        if (!op.resource) continue
        resNode(resources.get(op.resource.key))
        addEdge(`file:${fn.file}`, `res:${op.resource.key}`, op.rw === 'write' ? 'writes' : op.rw === 'read' ? 'reads' : 'uses', { file: fn.file, line: op.line, fnId: fn.id, opId: op.id })
      }
      if (d >= MAX_DEPTH) continue
      for (const e of callEdges.get(id) || []) {
        const t = fnById.get(e.to)
        if (!t || (isTest(t.file) && !isTest(fn.file))) continue
        if (t.file !== fn.file) {
          if (!nodes.has(`file:${t.file}`)) fileNode(t.file, 'logic')
          addEdge(`file:${fn.file}`, `file:${t.file}`, 'invokes', { file: fn.file, line: e.line, fnId: fn.id, to: t.id })
        }
        if (!seen.has(e.to)) {
          seen.add(e.to)
          q.push([e.to, d + 1])
        }
      }
    }
  }

  // 4. entries: frontend files with calls/DOM work, scripts, notebooks
  const entryFiles = new Set()
  for (const n of nodes.values()) if (n.type === 'file' && n.lane === 'entry') entryFiles.add(n.path)
  for (const [p, reason] of entries) {
    if (isTest(p) || fileRoles.get(p) === 'backend' || fileRoles.get(p) === 'config') continue
    const fns = functions.filter((f) => f.file === p)
    const touches = fns.some((f) => f.opIds.length || f.callees.length || f.httpIds.length)
    if (touches && !/^HTML page/.test(reason)) entryFiles.add(p)
  }
  for (const [p, cats] of fileOpCats) {
    if (isTest(p)) continue
    if ((cats.dom || cats.storage) && fileRoles.get(p) === 'frontend') entryFiles.add(p)
  }
  for (const p of entryFiles) {
    const n = fileNode(p, 'entry')
    n.lane = 'entry'
    walk(functions.filter((f) => f.file === p).map((f) => f.id))
  }

  // 5. route handlers
  for (const r of routes) {
    if (!r.handlerId) continue
    const fn = fnById.get(r.handlerId)
    if (!fn) continue
    handlerFiles.add(fn.file)
    const n = fileNode(fn.file, 'logic')
    if (n.lane === 'entry' && fileRoles.get(fn.file) === 'backend') n.lane = 'logic'
    addEdge(`route:${r.id}`, `file:${fn.file}`, 'handled', { file: fn.file, line: fn.line, fnId: fn.id })
    walk([fn.id])
  }

  // 6. work that nothing reaches (often dead code in vibecoded projects, or entry points we missed)
  for (const [p, cats] of fileOpCats) {
    if (isTest(p) || nodes.has(`file:${p}`)) continue
    const hasResource = ops.some((o) => o.file === p && o.resource)
    if (!hasResource && !cats.transform && !cats.scrape) continue
    const n = fileNode(p, 'logic')
    n.unreached = true
    walk(functions.filter((f) => f.file === p).map((f) => f.id))
  }

  // 7. prune logic files that lead nowhere interesting, but keep the steps an entry point or
  //    route handler calls directly (pure transform steps in a pipeline matter)
  const direct = new Set()
  for (const e of edges.values()) {
    if (e.kind !== 'invokes') continue
    const src = nodes.get(e.source)
    if (src && (src.lane === 'entry' || handlerFiles.has(src.path))) direct.add(e.target)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const n of [...nodes.values()]) {
      if (n.type !== 'file' || n.lane !== 'logic' || handlerFiles.has(n.path) || direct.has(n.id)) continue
      const hasOut = [...edges.values()].some((e) => e.source === n.id)
      const hasOps = Object.keys(n.ops || {}).length > 0
      if (!hasOut && !hasOps) {
        nodes.delete(n.id)
        for (const [id, e] of edges) if (e.source === n.id || e.target === n.id) edges.delete(id)
        changed = true
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}
