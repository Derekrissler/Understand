// Traces: the ordered "story" behind a node in the flow graph, with the functions
// involved, the lines that hand off to the next step, and what each step touches.

export function makeTracer(model, internal) {
  const fnById = new Map(model.functions.map((f) => [f.id, f]))
  const httpById = new Map(model.http.map((h) => [h.id, h]))
  const routeById = new Map(model.routes.map((r) => [r.id, r]))
  const ops = model.ops

  const step = (fn, role, extra = {}) => ({
    fnId: fn.id, file: fn.file, qual: fn.qual, name: fn.name, kind: fn.kind, line: fn.line, endLine: fn.endLine,
    doc: fn.doc, params: fn.params, runnable: fn.runnable, role,
    ops: fn.opIds.map((i) => ops[i]).map((o) => ({ id: o.id, line: o.line, cat: o.cat, label: o.label })),
    http: fn.httpIds.map((id) => httpById.get(id)).filter(Boolean).map((h) => ({ id: h.id, line: h.line, method: h.method, url: h.resolvedUrl, kind: h.kind, routeId: h.routeId })),
    links: (internal.callEdges.get(fn.id) || []).filter((e) => fnById.has(e.to)).map((e) => ({ line: e.line, to: e.to, toName: fnById.get(e.to).qual })),
    ...extra,
  })

  /** Breadth-first walk down the call graph, keeping steps that do something or lead somewhere. */
  const downstream = (startIds, { maxDepth = 5, maxSteps = 24, role = 'callee' } = {}) => {
    const seen = new Set(startIds)
    const order = []
    let frontier = startIds.map((id) => ({ id, depth: 0, from: null }))
    while (frontier.length && order.length < maxSteps * 3) {
      const next = []
      for (const { id, depth, from } of frontier) {
        if (depth > 0) order.push({ id, depth, from })
        if (depth >= maxDepth) continue
        for (const e of internal.callEdges.get(id) || []) {
          if (seen.has(e.to) || !fnById.has(e.to)) continue
          seen.add(e.to)
          next.push({ id: e.to, depth: depth + 1, from: id })
        }
      }
      frontier = next
    }
    // keep functions that touch data, or sit on the path to one that does
    const useful = new Set()
    const busy = (id) => {
      const f = fnById.get(id)
      return f && (f.opIds.length || f.httpIds.length)
    }
    for (const o of order.slice().reverse()) {
      if (busy(o.id) || useful.has(o.id)) {
        useful.add(o.id)
        if (o.from) useful.add(o.from)
      }
    }
    return order.filter((o) => useful.has(o.id)).slice(0, maxSteps).map((o) => step(fnById.get(o.id), role, { depth: o.depth, from: o.from }))
  }

  return function trace(nodeId) {
    const [kind, ...rest] = nodeId.split(':')
    const key = rest.join(':')

    if (kind === 'route') {
      const r = routeById.get(key)
      if (!r) return null
      const callers = r.callerIds.map((id) => httpById.get(id)).filter((h) => h && fnById.has(h.fnId))
      const steps = []
      const seenCallers = new Set()
      for (const h of callers) {
        if (seenCallers.has(h.fnId)) continue
        seenCallers.add(h.fnId)
        steps.push(step(fnById.get(h.fnId), 'caller', { focusLine: h.line, note: `${h.method} ${h.resolvedUrl}${h.viaPrefix ? ` (server strips ${h.viaPrefix})` : ''}${h.guess ? ' (probable match)' : ''}` }))
      }
      const handler = r.handlerId ? fnById.get(r.handlerId) : null
      if (handler) {
        steps.push(step(handler, 'handler', { focusLine: r.line, note: r.handlerApprox ? 'registered inside this function' : null }))
        steps.push(...downstream([handler.id]))
      }
      return { title: `${r.method} ${r.path}`, kind: 'route', route: r, steps }
    }

    if (kind === 'file') {
      const fns = model.functions.filter((f) => f.file === key)
      const busy = fns.filter((f) => f.opIds.length || f.httpIds.length || f.routeIds.length)
      const steps = busy.map((f) => step(f, 'in-file'))
      steps.push(...downstream(busy.map((f) => f.id), { maxDepth: 3, maxSteps: 14 }).filter((s) => s.file !== key))
      return { title: key, kind: 'file', file: model.files.find((f) => f.path === key), steps }
    }

    if (kind === 'res') {
      const res = model.resources.find((r) => r.key === key)
      if (!res) return null
      const byFn = new Map()
      for (const oid of res.opIds) {
        const o = ops[oid]
        if (!o.fnId || !fnById.has(o.fnId)) continue
        if (!byFn.has(o.fnId)) byFn.set(o.fnId, o.line)
      }
      for (const h of model.http) if (h.kind === 'static' && `file:${h.staticFile}` === key && h.fnId) byFn.set(h.fnId, h.line)
      const steps = [...byFn].map(([id, line]) => step(fnById.get(id), 'touches', { focusLine: line }))
      return { title: res.label, kind: 'resource', resource: res, steps }
    }

    if (kind === 'call') {
      const ids = model.flow.nodes.find((n) => n.id === nodeId)?.httpIds || []
      const hs = ids.map((id) => httpById.get(id)).filter(Boolean)
      const steps = hs.filter((h) => fnById.has(h.fnId)).map((h) => step(fnById.get(h.fnId), 'caller', { focusLine: h.line, note: `${h.method} ${h.resolvedUrl}` }))
      const suggestions = hs.flatMap((h) => h.suggestions || []).map((s) => ({ ...s, route: routeById.get(s.routeId) })).filter((s) => s.route)
      return { title: hs[0] ? `${hs[0].method} ${hs[0].path}` : nodeId, kind: 'call', status: hs[0]?.kind, calls: hs, suggestions, steps }
    }

    if (kind === 'fn') {
      const fn = fnById.get(key)
      if (!fn) return null
      const steps = fn.callers.slice(0, 6).map((id) => step(fnById.get(id), 'caller', { focusLine: (internal.callEdges.get(id) || []).find((e) => e.to === fn.id)?.line }))
      steps.push(step(fn, 'focus'))
      steps.push(...downstream([fn.id]))
      return { title: fn.qual, kind: 'function', steps }
    }
    return null
  }
}
