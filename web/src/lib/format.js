export const CAT_COLORS = {
  http: '#60a5fa', scrape: '#fb923c', dom: '#facc15', db: '#34d399', file: '#94a3b8', transform: '#818cf8',
  llm: '#c084fc', auth: '#f472b6', storage: '#2dd4bf', email: '#f9a8d4', process: '#f87171', realtime: '#22d3ee',
  payments: '#a3e635', jobs: '#fbbf24',
}
export const CAT_SHORT = {
  http: 'HTTP', scrape: 'scrape', dom: 'DOM', db: 'DB', file: 'file', transform: 'transform', llm: 'LLM', auth: 'auth',
  storage: 'storage', email: 'email', process: 'shell', realtime: 'realtime', payments: 'pay', jobs: 'jobs',
}
export const LANES = {
  entry: { label: 'Entry points', hint: 'pages, scripts, notebooks', color: 'var(--lane-entry)' },
  api: { label: 'API routes', hint: 'endpoints the code calls', color: 'var(--lane-api)' },
  logic: { label: 'Logic', hint: 'files doing the work', color: 'var(--lane-logic)' },
  data: { label: 'Data & services', hint: 'stores, files, outside APIs', color: 'var(--lane-data)' },
}
export const ROLE_COLORS = { frontend: '#60a5fa', backend: '#a78bfa', script: '#fb923c', test: '#5d6579', config: '#5d6579', shared: '#94a3b8', other: '#5d6579' }
export const RESOURCE_KIND = {
  db: 'Database', file: 'File', http: 'External API', web: 'Scraped site', llm: 'AI model', dom: 'Page DOM', storage: 'Browser storage',
  email: 'Email', process: 'Shell', realtime: 'Realtime', payments: 'Payments',
}

export const basename = (p) => String(p || '').split('/').pop()
export const dirname = (p) => {
  const parts = String(p || '').split('/')
  parts.pop()
  return parts.join('/')
}
export const plural = (n, word, pl) => `${n} ${n === 1 ? word : pl || word + 's'}`
export const fmtNum = (n) => (n == null ? '–' : n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))
export const fmtMs = (ms) => (ms == null ? '' : ms < 1 ? '<1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`)
export const fmtBytes = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`)
export const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
export const fnLabel = (fn) => {
  if (!fn) return '?'
  if (fn.qual === '<module>') return `${basename(fn.file)} (top level)`
  if (fn.qual === '<main>') return `${basename(fn.file)} __main__`
  return fn.qual
}
export const statusClass = (s) => `status s${String(s || 0)[0]}`
