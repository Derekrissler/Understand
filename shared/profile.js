// Data profiling shared by the server (run results, tapped responses) and the UI.
// The goal is to answer "is this the data I expect?" at a glance: how many rows,
// what each column looks like, and anything that smells wrong.

const typeOf = (v) => {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v === 'object' ? 'object' : typeof v
}

const isEmpty = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'number' && Number.isNaN(v))

const isPlainRecord = (v) => v && typeof v === 'object' && !Array.isArray(v)

/**
 * Locate the most "table-like" part of a value: an array of objects, a DataFrame,
 * or (at the top level only) an array of primitives.
 */
export function findRecords(value, path = '$', depth = 0) {
  if (Array.isArray(value)) {
    if (!value.length) return depth === 0 ? { path, records: [] } : null
    const objs = value.filter(isPlainRecord).length
    if (objs / value.length >= 0.8) return { path, records: value.filter(isPlainRecord) }
    if (depth === 0 && value.every((v) => v === null || typeof v !== 'object')) {
      return { path, records: value.map((v) => ({ value: v })), primitive: true }
    }
    return null
  }
  if (isPlainRecord(value)) {
    if (value.__type === 'DataFrame' && Array.isArray(value.records)) {
      return { path, records: value.records, frame: true }
    }
    if (depth >= 4) return null
    let best = null
    for (const [k, v] of Object.entries(value)) {
      const r = findRecords(v, `${path}.${k}`, depth + 1)
      if (r && r.records.length && (!best || r.records.length > best.records.length)) best = r
    }
    return best
  }
  return null
}

const NUMERIC_TEXT = /^\s*[-+]?[$€£¥]?\s*[-+]?\d[\d,]*(\.\d+)?\s*(%|k|m|usd)?\s*$/i
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>|&(amp|nbsp|lt|gt|quot|#\d+);/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/

export function profileRecords(records, { maxCols = 80 } = {}) {
  const n = records.length
  const order = []
  const seen = new Set()
  for (const r of records.slice(0, 3000)) {
    for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); order.push(k) }
  }
  const columns = order.slice(0, maxCols).map((name) => {
    const types = {}
    let empty = 0, nums = 0, sum = 0, min = null, max = null
    let strs = 0, minLen = null, maxLen = null, numericText = 0, htmlish = 0, padded = 0, dates = 0
    const unique = new Set()
    const samples = []
    for (const r of records) {
      const v = r[name]
      const t = typeOf(v)
      types[t] = (types[t] || 0) + 1
      if (isEmpty(v)) { empty++; continue }
      const key = typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v)
      if (unique.size < 20000) unique.add(key)
      if (samples.length < 3 && !samples.includes(key)) samples.push(key)
      if (typeof v === 'number' && Number.isFinite(v)) {
        nums++; sum += v
        min = min === null ? v : Math.min(min, v)
        max = max === null ? v : Math.max(max, v)
      } else if (typeof v === 'string') {
        strs++
        minLen = minLen === null ? v.length : Math.min(minLen, v.length)
        maxLen = maxLen === null ? v.length : Math.max(maxLen, v.length)
        if (NUMERIC_TEXT.test(v)) numericText++
        if (HTML_TAG.test(v)) htmlish++
        if (v !== v.trim() || /\s{3,}|\n/.test(v)) padded++
        if (ISO_DATE.test(v)) dates++
      }
    }
    const filled = n - empty
    const flags = []
    const pct = (x) => `${Math.round((x / Math.max(n, 1)) * 100)}%`
    if (n && empty / n >= 0.5) flags.push({ level: 'warn', text: `${pct(empty)} of rows are empty` })
    else if (empty) flags.push({ level: 'info', text: `${empty} empty (${pct(empty)})` })
    if (n > 3 && filled === n && unique.size === 1) flags.push({ level: 'warn', text: 'same value in every row' })
    const realTypes = Object.keys(types).filter((t) => t !== 'null')
    if (realTypes.length > 1) flags.push({ level: 'warn', text: `mixed types: ${realTypes.join(', ')}` })
    if (strs && numericText / strs >= 0.5 && !dates) {
      flags.push({ level: 'warn', text: `numbers stored as text (e.g. "${samples[0]}")` })
    }
    if (htmlish) flags.push({ level: 'warn', text: `${htmlish} value(s) contain HTML: scraping leftovers?` })
    if (padded) flags.push({ level: 'info', text: `${padded} value(s) have stray whitespace/newlines` })
    return {
      name,
      types,
      empty,
      unique: unique.size,
      uniqueCapped: unique.size >= 20000,
      samples,
      number: nums ? { min, max, mean: sum / nums } : null,
      text: strs ? { minLen, maxLen } : null,
      dateLike: strs > 0 && dates / strs >= 0.8,
      flags,
    }
  })

  // duplicate rows
  let duplicates = 0
  if (n <= 50000) {
    const rows = new Set()
    for (const r of records) {
      const k = JSON.stringify(r)
      if (rows.has(k)) duplicates++
      else rows.add(k)
    }
  }

  const warnings = []
  if (n === 0) warnings.push({ level: 'warn', text: 'No rows: the step produced an empty result' })
  if (duplicates) warnings.push({ level: 'warn', text: `${duplicates} duplicate row(s)` })
  for (const c of columns) for (const f of c.flags) if (f.level === 'warn') warnings.push({ level: 'warn', column: c.name, text: f.text })
  if (order.length > maxCols) warnings.push({ level: 'info', text: `${order.length - maxCols} more columns not profiled` })

  return { rows: n, columns, duplicates, warnings }
}

/** Describe any value: where its table is (if any) and how that table looks. */
export function profileValue(value) {
  const found = findRecords(value)
  if (!found) {
    return { kind: typeOf(value), summary: summarizeScalar(value) }
  }
  return {
    kind: found.frame ? 'dataframe' : found.primitive ? 'list' : 'records',
    path: found.path,
    ...profileRecords(found.records),
  }
}

function summarizeScalar(v) {
  const t = typeOf(v)
  if (t === 'string') return `${v.length} characters`
  if (t === 'object') return `${Object.keys(v).length} keys`
  if (t === 'array') return `${v.length} items`
  return String(v)
}

/** Make a value small enough to ship to the browser, marking what was cut. */
export function previewValue(value, { maxItems = 200, maxString = 5000, maxDepth = 10 } = {}) {
  const walk = (v, depth) => {
    if (typeof v === 'string') {
      return v.length > maxString ? v.slice(0, maxString) + `… [+${v.length - maxString} chars]` : v
    }
    if (v === null || typeof v !== 'object') return v
    if (depth >= maxDepth) return { __truncated: 'depth' }
    if (Array.isArray(v)) {
      const out = v.slice(0, maxItems).map((x) => walk(x, depth + 1))
      if (v.length > maxItems) out.push({ __truncated: 'items', total: v.length, shown: maxItems })
      return out
    }
    const out = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === 'records' && v.__type === 'DataFrame' && Array.isArray(x)) {
        out[k] = x.slice(0, maxItems).map((r) => walk(r, depth + 1))
        if (x.length > maxItems) out.__recordsTotal = x.length
      } else out[k] = walk(x, depth + 1)
    }
    return out
  }
  return walk(value, 0)
}
