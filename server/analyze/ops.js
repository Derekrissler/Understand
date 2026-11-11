// Shared vocabulary for "crucial operations": the lines of code that move data
// in or out of the program. Each extractor emits ops in this shape:
//   { cat, verb, label, target, lib, line, fn, resource: { key, label, kind } | null }
// `resource` decides which node the op connects to in the Data & External lane.

export const CATEGORIES = {
  http: { label: 'Network calls', blurb: 'Requests to your own API or to outside services' },
  scrape: { label: 'Scraping', blurb: 'Loading web pages and pulling data out of their HTML' },
  dom: { label: 'Page DOM', blurb: 'Reading or writing elements on the current web page' },
  db: { label: 'Database', blurb: 'Queries, inserts and updates against a data store' },
  file: { label: 'Files', blurb: 'Reading and writing files on disk' },
  transform: { label: 'Data transforms', blurb: 'Reshaping, cleaning and aggregating data' },
  llm: { label: 'AI / LLM', blurb: 'Calls to language-model APIs' },
  auth: { label: 'Auth', blurb: 'Tokens, passwords and sessions' },
  storage: { label: 'Browser storage', blurb: 'localStorage, sessionStorage, IndexedDB, extension storage' },
  email: { label: 'Email', blurb: 'Sending email' },
  process: { label: 'Processes', blurb: 'Running shell commands or child processes' },
  realtime: { label: 'Realtime', blurb: 'WebSockets, Socket.IO, server-sent events, messaging' },
  payments: { label: 'Payments', blurb: 'Stripe and other payment providers' },
  jobs: { label: 'Scheduled jobs', blurb: 'Timers, cron schedules and background queues' },
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:\d+)?$/i

/**
 * Classify a URL string (which may contain ${placeholders}) as a call into this
 * project ("internal"), to someone else ("external"), or unknowable ("dynamic").
 */
export function parseUrl(raw) {
  if (raw == null) return { kind: 'dynamic' }
  let s = String(raw).trim()
  let base = null
  const lead = s.match(/^\$\{([^}]*)\}/)
  if (lead) {
    base = lead[1]
    s = s.slice(lead[0].length)
  }
  const abs = s.match(/^(https?|wss?):\/\/([^/?#]+)(.*)$/i)
  if (abs) {
    const host = abs[2].toLowerCase()
    const p = (abs[3] || '/').split(/[?#]/)[0] || '/'
    if (LOCAL_HOST.test(host) || host.includes('${')) return { kind: 'internal', host, path: p }
    return { kind: 'external', host: host.replace(/^www\./, ''), path: p }
  }
  if (/^\/\//.test(s)) return { kind: 'external', host: s.slice(2).split('/')[0], path: '/' }
  const clean = s.split(/[?#]/)[0]
  if (clean.startsWith('/')) return { kind: 'internal', path: clean, base }
  if (base !== null) {
    if (!clean) return { kind: 'dynamic', base }
    return { kind: 'internal', path: '/' + clean.replace(/^\/+/, ''), base }
  }
  if (/^[\w.-]+\/[\w./${}:-]*$/.test(clean) && !/\.(com|org|net|io|dev|app)\b/.test(clean)) {
    return { kind: 'internal', path: '/' + clean, base: '' }
  }
  return { kind: 'dynamic' }
}

export function hostResource(host, kind = 'http') {
  const h = host.replace(/^www\./, '')
  return { kind, key: `${kind}:${h}`, label: h }
}

const SQL_TABLE = /\b(?:from|into|update|join|table(?:\s+if\s+(?:not\s+)?exists)?)\s+[`"[]?([a-zA-Z_][\w.]*)[`"\]]?/gi
const SQL_VERB = /^\s*(select|insert|update|delete|create|drop|alter|with|replace|upsert|merge|pragma)\b/i

export function looksLikeSql(s) {
  return typeof s === 'string' && SQL_VERB.test(s)
}

export function sqlInfo(s) {
  if (!looksLikeSql(s)) return null
  const verb = s.match(SQL_VERB)[1].toUpperCase()
  const tables = new Set()
  for (const m of s.matchAll(SQL_TABLE)) {
    const t = m[1].toLowerCase()
    if (!['select', 'set', 'values', 'where', 'exists', 'not', 'if', 'the', '$'].includes(t) && !t.startsWith('$')) tables.add(m[1])
  }
  return { verb, tables: [...tables] }
}

export function sqlVerbKind(verb) {
  return /^(SELECT|WITH|PRAGMA)$/.test(verb) ? 'read' : 'write'
}

/** Normalise a file path expression into a resource key. */
export function fileResource(p) {
  if (!p) return { kind: 'file', key: 'file:*', label: 'files (dynamic path)' }
  let s = String(p).replace(/\\/g, '/')
  s = s.replace(/^(\$\{[^}]*\}\/?)+/, '').replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\.(tmp|temp|part|bak)$|~$/i, '')
  if (!s || /^\$\{[^}]*\}$/.test(s) || /^\.[a-z]+$/i.test(s)) return { kind: 'file', key: 'file:*', label: 'files (dynamic path)' }
  const label = s.replace(/\$\{[^}]*\}/g, '*')
  return { kind: 'file', key: `file:${label}`, label }
}

// Hosts that are really LLM APIs, so calls to them count as AI rather than data sources.
const AI_HOSTS = { 'generativelanguage.googleapis.com': 'Gemini', 'api.openai.com': 'OpenAI', 'api.anthropic.com': 'Anthropic', 'api.groq.com': 'Groq', 'api.mistral.ai': 'Mistral', 'api.cohere.ai': 'Cohere', 'api.cohere.com': 'Cohere', 'openrouter.ai': 'OpenRouter', 'api.together.xyz': 'Together', 'api.deepseek.com': 'DeepSeek', 'api.perplexity.ai': 'Perplexity', 'api-inference.huggingface.co': 'Hugging Face', 'api.replicate.com': 'Replicate', 'localhost:11434': 'Ollama', '127.0.0.1:11434': 'Ollama' }
export function aiProvider(host) {
  if (!host) return null
  const h = String(host).toLowerCase().replace(/^www\./, '')
  return AI_HOSTS[h] || (/\.openai\.azure\.com$/.test(h) ? 'Azure OpenAI' : null)
}

export function dbResource(table, engine) {
  if (table) return { kind: 'db', key: `db:${String(table).toLowerCase()}`, label: table, engine }
  return { kind: 'db', key: `db:${(engine || 'database').toLowerCase()}`, label: engine || 'database', engine }
}

export function shortSel(s, max = 48) {
  if (!s) return ''
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
