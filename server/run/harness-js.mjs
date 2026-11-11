// Understand's JS/TS harness: import a project module (via tsx, so TS works), call one
// exported function and write the result. Usage: node --import tsx harness-js.mjs job.json
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const MAX_ITEMS = 50000

function ser(v, depth = 0, seen = new WeakSet()) {
  if (depth > 40) return '[too deep]'
  if (v === null || v === undefined) return v ?? null
  const t = typeof v
  if (t === 'string' || t === 'boolean') return v
  if (t === 'number') return Number.isFinite(v) ? v : Number.isNaN(v) ? null : String(v)
  if (t === 'bigint') return v.toString()
  if (t === 'function') return `[function ${v.name || 'anonymous'}]`
  if (t === 'symbol') return v.toString()
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (v instanceof RegExp) return v.toString()
  if (v instanceof Error) return { __type: 'Error', name: v.name, message: v.message }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return { __type: 'Bytes', length: v.length, preview: v.subarray(0, 400).toString('utf8') }
  if (ArrayBuffer.isView(v)) return Array.from(v.slice(0, MAX_ITEMS))
  if (seen.has(v)) return '[circular]'
  seen.add(v)
  try {
    if (v instanceof Map) return { __type: 'Map', entries: [...v].slice(0, MAX_ITEMS).map(([k, x]) => [ser(k, depth + 1, seen), ser(x, depth + 1, seen)]) }
    if (v instanceof Set) return [...v].slice(0, MAX_ITEMS).map((x) => ser(x, depth + 1, seen))
    if (Array.isArray(v)) {
      const out = v.slice(0, MAX_ITEMS).map((x) => ser(x, depth + 1, seen))
      if (v.length > MAX_ITEMS) out.push({ __truncated: 'items', shown: MAX_ITEMS, total: v.length })
      return out
    }
    const out = {}
    const proto = Object.getPrototypeOf(v)
    for (const [k, x] of Object.entries(v)) out[k] = ser(x, depth + 1, seen)
    if (proto && proto !== Object.prototype && proto.constructor?.name) out.__class = proto.constructor.name
    return out
  } finally {
    seen.delete(v)
  }
}

async function settle(v) {
  if (v && typeof v.then === 'function') v = await v
  if (typeof Response !== 'undefined' && v instanceof Response) {
    const text = await v.text()
    let body = text
    try { body = JSON.parse(text) } catch {}
    return { __type: 'Response', status: v.status, url: v.url, headers: Object.fromEntries(v.headers), body }
  }
  if (v && typeof v[Symbol.asyncIterator] === 'function' && typeof v.next === 'function') {
    const out = []
    for await (const x of v) { out.push(x); if (out.length >= 10000) break }
    return out
  }
  if (v && typeof v[Symbol.iterator] === 'function' && typeof v.next === 'function') {
    const out = []
    for (const x of v) { out.push(x); if (out.length >= 10000) break }
    return out
  }
  return v
}

function pick(mod, exported, qual) {
  const name = String(exported || '')
  if (name.endsWith('#')) {
    const ownerName = name.slice(0, -1)
    const owner = ownerName === 'default' ? mod.default : mod[ownerName] ?? mod.default?.[ownerName]
    const method = qual.split('.').pop()
    if (owner == null) throw new Error(`Export "${ownerName}" not found in module`)
    if (typeof owner === 'function') {
      if (typeof owner[method] === 'function') return owner[method].bind(owner)
      const inst = new owner(...(job.ctorArgs || []))
      if (typeof inst[method] !== 'function') throw new Error(`${ownerName}.${method} is not a function`)
      return inst[method].bind(inst)
    }
    if (typeof owner[method] !== 'function') throw new Error(`${ownerName}.${method} is not a function`)
    return owner[method].bind(owner)
  }
  if (name === 'default') return typeof mod.default === 'function' ? mod.default : mod.default?.default
  const f = mod[name] ?? mod.default?.[name]
  if (typeof f !== 'function') throw new Error(`Export "${name}" is ${f === undefined ? 'missing' : typeof f}, not a function`)
  return f
}

const write = (o) => fs.writeFileSync(job.out, JSON.stringify(o))
let t0 = performance.now()
try {
  process.chdir(job.cwd || process.cwd())
  const mod = await import(pathToFileURL(job.file).href)
  const fn = pick(mod, job.exported, job.qual)
  t0 = performance.now()
  // {"__undefined__": true} marks a skipped argument so the function's own default applies
  const args = (job.args || []).map((a) => (a && typeof a === 'object' && a.__undefined__ === true && Object.keys(a).length === 1 ? undefined : a))
  const value = await settle(fn(...args))
  write({ ok: true, value: ser(value), type: value === null || value === undefined ? 'None' : Array.isArray(value) ? 'Array' : typeof value === 'object' ? value.constructor?.name || 'Object' : typeof value, durationMs: performance.now() - t0, node: process.version })
} catch (e) {
  write({ ok: false, error: { type: e?.name || 'Error', message: String(e?.message ?? e), traceback: String(e?.stack ?? '') }, durationMs: performance.now() - t0, node: process.version })
}
// don't let open servers, timers or DB pools keep the harness alive
process.exit(0)
