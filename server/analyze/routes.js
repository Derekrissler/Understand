// Route paths: normalising framework-specific syntax and matching client calls
// (or live requests) to the routes that serve them.

/** Turn any framework's path into comparable segments; parameters become ':'. */
export function segments(p) {
  let s = String(p ?? '/')
  s = s.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0]
  return s
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (/^(\*\*|\*|\{\*\w*\}|\[\.\.\.\w+\]|\[\[\.\.\.\w+\]\]|:\w+\*|\{\w+:\.\*\})$/.test(seg)) return '**'
      if (/^(:|\{|<|\[)/.test(seg) || seg.includes('${') || seg === '…') return ':'
      return seg.toLowerCase()
    })
}

export function joinPaths(...parts) {
  const s = parts
    .filter((x) => x != null && x !== '')
    .map((x) => String(x).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return '/' + s
}

export function displayPath(p) {
  const s = String(p || '/').replace(/\/{2,}/g, '/')
  return s.length > 1 ? s.replace(/\/$/, '') : s
}

const methodOk = (routeMethod, method) => {
  const rm = (routeMethod || 'ANY').toUpperCase()
  const m = (method || 'GET').toUpperCase()
  return rm === 'ANY' || rm === 'ALL' || rm === 'USE' || rm === m || (m === 'HEAD' && rm === 'GET')
}

/** Score how well call segments match route segments (null = no match). */
function matchScore(routeSegs, callSegs) {
  let score = 0
  for (let i = 0; i < routeSegs.length; i++) {
    const r = routeSegs[i]
    if (r === '**') return score + 0.5
    const c = callSegs[i]
    if (c === undefined) return null
    if (r === c) score += 2
    else if (r === ':' || c === ':') score += 1
    else return null
  }
  return routeSegs.length === callSegs.length ? score : null
}

/**
 * Find the route a request hits.
 * @param routes  [{ id, method, segs }]
 * @param opts    { suffix: allow matching only the tail of the route (unknown base URL) }
 */
export function matchRoute(routes, method, path, { suffix = false } = {}) {
  const callSegs = segments(path)
  let best = null
  for (const r of routes) {
    if (!methodOk(r.method, method)) continue
    let s = matchScore(r.segs, callSegs)
    let partial = false
    if (s == null && r.openPrefix && callSegs.length > r.segs.length) {
      // route registered as `${prefix}/chats`: match on the tail
      s = matchScore(r.segs, callSegs.slice(callSegs.length - r.segs.length))
      if (s != null) { s -= 0.5; partial = true }
    }
    if (s == null && suffix && r.segs.length > callSegs.length) {
      s = matchScore(r.segs.slice(r.segs.length - callSegs.length), callSegs)
      if (s != null) { s -= 0.5; partial = true }
    }
    if (s == null) continue
    const exactMethod = (r.method || '').toUpperCase() === (method || 'GET').toUpperCase()
    const total = s + (exactMethod ? 0.25 : 0)
    if (!best || total > best.score) best = { route: r, score: total, partial }
  }
  return best
}

/** Explain why a call doesn't match anything: same path with another method, or near misses. */
export function suggestRoutes(routes, method, path, limit = 3) {
  const callSegs = segments(path)
  const out = []
  for (const r of routes) {
    const s = matchScore(r.segs, callSegs)
    if (s != null && !methodOk(r.method, method)) out.push({ routeId: r.id, reason: `exists, but as ${r.method}`, dist: 0 })
  }
  if (out.length) return out.slice(0, limit)
  const a = callSegs.join('/')
  const scored = routes.map((r) => ({ routeId: r.id, dist: levenshtein(a, r.segs.join('/')), reason: 'similar path' }))
  scored.sort((x, y) => x.dist - y.dist)
  return scored.filter((x) => x.dist <= Math.max(3, a.length * 0.35)).slice(0, limit)
}

function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}

/** File-system routes (Next.js, SvelteKit, Nuxt). Returns [{ method, path, handlerExport }] */
export function fileRoutes(filePath, exportNames, { nuxtHandler = false } = {}) {
  const p = filePath
  const conv = (seg) => seg.replace(/^\[\[\.\.\.(\w+)\]\]$/, '**').replace(/^\[\.\.\.(\w+)\]$/, '**').replace(/^\[(\w+)\]$/, ':$1')
  const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  let m = p.match(/(?:^|\/)pages\/(api\/.+)\.(js|jsx|ts|tsx|mjs)$/)
  if (m) {
    const segs = m[1].split('/').map(conv)
    if (segs[segs.length - 1] === 'index') segs.pop()
    return [{ method: 'ANY', path: '/' + segs.join('/'), handlerExport: 'default', framework: 'next' }]
  }
  m = p.match(/(?:^|\/)app\/((?:.+\/)?)route\.(js|ts|mjs)$/)
  if (m) {
    const segs = m[1].split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')).map(conv)
    const verbs = VERBS.filter((v) => exportNames.includes(v))
    return (verbs.length ? verbs : ['ANY']).map((v) => ({ method: v, path: '/' + segs.join('/'), handlerExport: verbs.length ? v : 'default', framework: 'next' }))
  }
  m = p.match(/(?:^|\/)src\/routes\/((?:.+\/)?)\+server\.(js|ts)$/)
  if (m) {
    const segs = m[1].split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s)).map(conv)
    const verbs = VERBS.filter((v) => exportNames.includes(v))
    return (verbs.length ? verbs : ['ANY']).map((v) => ({ method: v, path: '/' + segs.join('/'), handlerExport: v, framework: 'sveltekit' }))
  }
  m = p.match(/(?:^|\/)server\/(api|routes)\/(.+?)(?:\.(get|post|put|patch|delete))?\.(js|ts)$/)
  if (m && nuxtHandler) {
    const segs = m[2].split('/').map(conv)
    if (segs[segs.length - 1] === 'index') segs.pop()
    return [{ method: (m[3] || 'ANY').toUpperCase(), path: (m[1] === 'api' ? '/api/' : '/') + segs.join('/'), handlerExport: 'default', framework: 'nuxt' }]
  }
  return []
}
