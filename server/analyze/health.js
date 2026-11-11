// "Things a vibecoded project tends to hide": calls to endpoints that don't exist,
// dead files, copy-pasted functions, hardcoded secrets, undocumented env vars.
import crypto from 'node:crypto'
import path from 'node:path'

const P = path.posix
const GENERIC = new Set(['main', 'init', '__init__', 'handler', 'index', 'default', 'render', 'setup', 'constructor', 'get', 'post', 'put', 'delete', 'run', 'toString', 'equals', 'hashCode', 'App', 'Layout', 'Page', 'Home', 'load', 'start', 'stop', 'close', 'open', 'update', 'create', 'test', '__str__', '__repr__', 'execute', 'call', 'apply', 'handle', 'process', 'onClick', 'onSubmit', 'onChange', 'getById', 'findAll', 'delete_', 'GET', 'POST'])

const SECRET_PATTERNS = [
  [/\bsk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{24,}/, 'API key (OpenAI / Anthropic style)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\b(sk|rk)_live_[A-Za-z0-9]{20,}/, 'Stripe live key'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'Private key'],
  [/\b(mongodb(\+srv)?|postgres(ql)?|mysql|redis):\/\/[^:\s/'"]+:[^@\s'"]{3,}@/, 'Database URL with password'],
  [/\b(password|passwd|pwd|secret|api_?key|apikey|access_?token|auth_?token|client_?secret)\b\s*[:=]\s*["'][^"'\s${}]{8,}["']/i, 'Hardcoded credential'],
]

function mask(s) {
  if (s.length <= 8) return '••••'
  return s.slice(0, 4) + '••••' + ` (${s.length} chars)`
}

export function analyzeHealth({ files, texts, fileFacts, fileRoles, functions, routes, http, entries, importedBy, stack, gitignoreText, virtual }) {
  const out = {}

  out.unmatchedCalls = http.filter((h) => h.kind === 'unmatched' && fileRoles.get(h.file) !== 'test').map((h) => h.id)
  const calledRoutes = new Set(http.filter((h) => h.routeId).map((h) => h.routeId))
  const hasClientCalls = http.some((h) => h.kind === 'route' || h.kind === 'unmatched')
  out.routesWithoutCallers = hasClientCalls ? routes.filter((r) => !calledRoutes.has(r.id)).map((r) => r.id) : []

  // orphans
  const fileRouteFiles = new Set(routes.filter((r) => ['next', 'sveltekit', 'nuxt'].includes(r.framework)).map((r) => r.file))
  out.orphans = []
  for (const f of files) {
    const facts = fileFacts.get(f.path)
    if (!facts) continue
    const role = fileRoles.get(f.path)
    if (role === 'test' || role === 'config' || f.lang === 'html' || f.lang === 'notebook') continue
    if ((importedBy.get(f.path) || []).length || entries.has(f.path) || fileRouteFiles.has(f.path)) continue
    if (facts.routes?.length) continue
    const base = P.basename(f.path)
    if (/\.d\.ts$|^(index|main|app|server|cli|setup|manage|wsgi|asgi|conftest|__init__|__main__)\.\w+$|(^|\/)(migrations?|alembic|seeds?|public|static|scripts?)\//.test(f.path) || /^(App|_app|_document|layout|page|loading|error|not-found|template|middleware)\.\w+$/.test(base) || /\+(page|layout|server)\./.test(base)) continue
    if (facts.lang === 'java') {
      if ((facts.classes || []).some((c) => c.annotations.length || c.springApp)) continue
      if (functions.some((fn) => fn.file === f.path && fn.kind === 'main')) continue
    }
    if (facts.lang === 'python' && functions.some((fn) => fn.file === f.path && fn.qual === '<main>')) continue
    const fnCount = functions.filter((fn) => fn.file === f.path && fn.qual !== '<module>').length
    out.orphans.push({ file: f.path, functions: fnCount, loc: f.loc || 0 })
  }

  // duplicates
  const byName = new Map()
  for (const fn of functions) {
    if (fn.qual === '<module>' || fn.qual === '<main>' || GENERIC.has(fn.name) || fn.name.length < 4 || fn.kind === 'handler' || fn.kind === 'repository') continue
    if (fn.endLine - fn.line < 3 || fileRoles.get(fn.file) === 'test') continue
    if (!byName.has(fn.name)) byName.set(fn.name, [])
    byName.get(fn.name).push(fn)
  }
  const hashOf = (fn) => {
    const t = virtual.get(fn.file) ?? texts.get(fn.file)
    if (!t) return null
    const body = t.split('\n').slice(fn.defLine ? fn.defLine : fn.line, fn.endLine).join('\n').replace(/\s+/g, ' ').trim()
    return crypto.createHash('sha1').update(body).digest('hex')
  }
  out.duplicates = []
  for (const [name, list] of byName) {
    const filesSet = new Set(list.map((f) => f.file))
    if (filesSet.size < 2) continue
    const hashes = list.map(hashOf)
    const identical = hashes.every((h) => h && h === hashes[0])
    out.duplicates.push({ name, identical, fnIds: list.map((f) => f.id).slice(0, 8) })
  }
  out.duplicates.sort((a, b) => Number(b.identical) - Number(a.identical) || b.fnIds.length - a.fnIds.length)
  out.duplicates = out.duplicates.slice(0, 40)

  out.largeFiles = files.filter((f) => (f.loc || 0) > 800 && fileFacts.has(f.path)).map((f) => ({ file: f.path, loc: f.loc })).sort((a, b) => b.loc - a.loc).slice(0, 25)
  out.largeFunctions = functions.filter((f) => !['<module>', '<main>'].includes(f.qual) && f.kind !== 'repository' && f.endLine - f.line > 120).map((f) => ({ fnId: f.id, lines: f.endLine - f.line + 1 })).sort((a, b) => b.lines - a.lines).slice(0, 25)

  // TODOs and secrets
  out.todos = []
  out.secrets = []
  for (const f of files) {
    const t = texts.get(f.path)
    if (t == null || !fileFacts.has(f.path)) continue
    const lines = t.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (out.todos.length < 300) {
        const m = l.match(/(?:\/\/|#|\/\*|\*|<!--)\s*\b(TODO|FIXME|HACK|XXX|BUG)\b[:\s-]*(.{0,120})/)
        if (m) out.todos.push({ file: f.path, line: i + 1, tag: m[1], text: m[2].replace(/\*\/|-->/g, '').trim() })
      }
      if (l.length > 2000) continue
      for (const [re, kind] of SECRET_PATTERNS) {
        const m = l.match(re)
        if (m && !/process\.env|os\.environ|getenv|example|placeholder|your[_-]|xxxx|<.*>|\$\{/i.test(m[0])) {
          out.secrets.push({ file: f.path, line: i + 1, kind, preview: mask(m[0]) })
          break
        }
      }
    }
  }
  const rootEnv = files.find((f) => /^\.env(\.local|\.production|\.development)?$/.test(f.path))
  out.envFileNotIgnored = rootEnv && !/(^|\n)\s*\/?\.env/.test(gitignoreText || '') ? rootEnv.path : null

  out.undocumentedEnv = stack.env.filter((e) => !e.documented && !e.property).map((e) => e.name)
  out.parseErrors = [...fileFacts].filter(([, f]) => f.errors?.length).map(([file, f]) => ({ file, error: String(f.errors[0]).slice(0, 200) })).slice(0, 50)
  out.unusedDeps = stack.unusedDeps

  out.counts = {
    unmatchedCalls: out.unmatchedCalls.length,
    routesWithoutCallers: out.routesWithoutCallers.length,
    orphans: out.orphans.length,
    duplicates: out.duplicates.length,
    identicalDuplicates: out.duplicates.filter((d) => d.identical).length,
    largeFiles: out.largeFiles.length,
    largeFunctions: out.largeFunctions.length,
    todos: out.todos.length,
    secrets: out.secrets.length,
    undocumentedEnv: out.undocumentedEnv.length,
    parseErrors: out.parseErrors.length,
    unusedDeps: out.unusedDeps.length,
  }
  return out
}
