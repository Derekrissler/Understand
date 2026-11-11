// Lane layout for the flow graph: fixed columns (entry → api → logic… → data) with
// barycentre ordering inside each column to keep edges from crossing.
export const NODE_W = 236
export const NODE_H = 66
const GAP_X = 120
const GAP_Y = 14

export function layoutLanes(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map()
  const inn = new Map()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    if (!out.has(e.source)) out.set(e.source, [])
    if (!inn.has(e.target)) inn.set(e.target, [])
    out.get(e.source).push(e.target)
    inn.get(e.target).push(e.source)
  }

  // logic files get sub-columns by how far they are from the API / entry
  const depth = new Map()
  const logic = nodes.filter((n) => n.lane === 'logic')
  const queue = []
  for (const n of logic) {
    const preds = (inn.get(n.id) || []).map((id) => byId.get(id))
    if (!preds.some((p) => p.lane === 'logic')) {
      depth.set(n.id, 0)
      queue.push(n.id)
    }
  }
  while (queue.length) {
    const id = queue.shift()
    for (const t of out.get(id) || []) {
      if (byId.get(t)?.lane === 'logic' && !depth.has(t)) {
        depth.set(t, depth.get(id) + 1)
        queue.push(t)
      }
    }
  }
  for (const n of logic) if (!depth.has(n.id)) depth.set(n.id, 0)
  const maxD = logic.length ? Math.min(2, Math.max(...logic.map((n) => depth.get(n.id)))) : 0

  let c = 0
  const entryCol = nodes.some((n) => n.lane === 'entry') ? c++ : -1
  const apiCol = nodes.some((n) => n.lane === 'api') ? c++ : -1
  const logicStart = c
  if (logic.length) c += maxD + 1
  const dataCol = c
  const colOf = (n) => (n.lane === 'entry' ? entryCol : n.lane === 'api' ? apiCol : n.lane === 'logic' ? logicStart + Math.min(depth.get(n.id), maxD) : dataCol)

  const columns = new Map()
  for (const n of nodes) {
    const k = colOf(n)
    if (!columns.has(k)) columns.set(k, [])
    columns.get(k).push(n)
  }
  for (const list of columns.values()) list.sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')) || String(a.label).localeCompare(String(b.label)))
  const keys = [...columns.keys()].sort((a, b) => a - b)
  const y = new Map()
  const place = () => {
    for (const k of keys) {
      const list = columns.get(k)
      list.forEach((n, i) => y.set(n.id, i - (list.length - 1) / 2))
    }
  }
  place()
  const col = new Map(nodes.map((n) => [n.id, colOf(n)]))
  for (let iter = 0; iter < 10; iter++) {
    const order = iter % 2 === 0 ? keys : [...keys].reverse()
    for (const k of order) {
      const list = columns.get(k)
      const score = new Map()
      for (const n of list) {
        const ns = [...(out.get(n.id) || []), ...(inn.get(n.id) || [])].filter((id) => col.get(id) !== k)
        score.set(n.id, ns.length ? ns.reduce((s, id) => s + y.get(id), 0) / ns.length : y.get(n.id))
      }
      list.sort((a, b) => score.get(a.id) - score.get(b.id))
      list.forEach((n, i) => y.set(n.id, i - (list.length - 1) / 2))
    }
  }

  const positions = new Map()
  let top = 0
  for (const k of keys) {
    const list = columns.get(k)
    list.forEach((n, i) => {
      const py = (i - (list.length - 1) / 2) * (NODE_H + GAP_Y)
      positions.set(n.id, { x: keys.indexOf(k) * (NODE_W + GAP_X), y: py })
      top = Math.min(top, py)
    })
  }
  const headers = keys.map((k, i) => {
    const lane = k === entryCol ? 'entry' : k === apiCol ? 'api' : k === dataCol ? 'data' : 'logic'
    return { id: `lane:${k}`, lane, x: i * (NODE_W + GAP_X), y: top - 74, step: lane === 'logic' && maxD > 0 ? k - logicStart + 1 : null }
  })
  return { positions, headers }
}

/** Everything upstream and downstream of a node. */
export function chainOf(id, edges) {
  const out = new Map()
  const inn = new Map()
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, [])
    if (!inn.has(e.target)) inn.set(e.target, [])
    out.get(e.source).push(e.target)
    inn.get(e.target).push(e.source)
  }
  const seen = new Set([id])
  const walk = (start, map) => {
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()
      for (const nx of map.get(cur) || []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
    }
  }
  walk(id, out)
  const down = new Set(seen)
  walk(id, inn)
  for (const d of down) seen.add(d)
  return seen
}
