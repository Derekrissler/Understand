// The high-level story of a project: where its data comes from, what happens to it,
// where it is kept, how it is served, and where people see it. Everything here is
// condensed to a few plain-English steps with just enough evidence (key code lines,
// field names, a safe "prove it" plan) to explain the project convincingly.
import path from 'node:path'

const P = path.posix

const VERBS = new Set(['clean', 'parse', 'transform', 'normalize', 'normalise', 'process', 'analyze', 'analyse', 'summarize', 'summarise', 'compute', 'calculate', 'aggregate', 'filter', 'rank', 'score', 'format', 'build', 'shape', 'convert', 'enrich', 'dedupe', 'merge', 'validate', 'classify', 'extract', 'map', 'group', 'sort', 'tokenize', 'predict', 'train', 'evaluate', 'generate', 'prepare', 'combine', 'join', 'split', 'match', 'detect', 'count', 'estimate', 'fetch', 'get', 'load', 'read', 'scrape', 'crawl', 'download', 'save', 'write', 'store', 'send', 'push', 'post', 'upload', 'update', 'create', 'delete', 'remove', 'insert', 'sync', 'render', 'show', 'display', 'list', 'find', 'search', 'handle', 'run', 'make', 'check', 'ask', 'call', 'collect', 'gather', 'pull', 'export', 'import', 'notify', 'email', 'schedule', 'describe', 'explain', 'mirror', 'refresh', 'apply', 'resolve', 'select', 'pick', 'add', 'set', 'reply', 'stream', 'answer', 'chat', 'summon', 'plan', 'review', 'grade', 'submit'])
const DATA_VERB = /^(clean|parse|transform|normali[sz]e|process|analy[sz]e|summari[sz]e|compute|calculate|aggregate|filter|rank|score|format|build|shape|convert|enrich|dedupe|merge|validate|classify|extract|map|group|sort|tokeni[sz]e|predict|train|evaluate|generate|prepare|combine|match|detect|count|estimate|describe|explain|grade|review|reply|answer|plan)/i
const GENERIC = /^(get|set|init|helper|util|utils|handler|main|run|wrap|noop|default|callback|cb|fn|next|log|debug)$/i

const words = (name) => String(name || '').replace(/[<>#~]/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase().split(/\s+/).filter(Boolean)
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const third = (v) => (v === 'do' ? 'does' : v === 'go' ? 'goes' : /(s|sh|ch|x|z|o)$/.test(v) ? v + 'es' : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + 'ies' : v + 's')
const firstSentence = (s) => {
  if (!s) return null
  const t = String(s).replace(/\s+/g, ' ').trim()
  const m = t.match(/^(.{12,220}?[.!?])(\s|$)/)
  return (m ? m[1] : t.slice(0, 220)).replace(/^NOTE:\s*/i, '')
}
const list = (items, max = 3) => {
  const xs = [...new Set(items.filter(Boolean))]
  const shown = xs.slice(0, max)
  const extra = xs.length - shown.length
  if (extra > 0) shown.push(`${extra} more`)
  if (shown.length <= 1) return shown[0] || ''
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}
const plural = (n, w, pl) => `${n} ${n === 1 ? w : pl || w + 's'}`
const sentence = (t) => (!t ? '' : /[.!?]$/.test(t.trim()) ? t.trim() : t.trim() + '.')
const agree = (items, verb) => (items.length === 1 ? third(verb) : verb)

/** https://host/a/${x}/b/c.json?q=${y} -> host/a/…/c.json */
export function prettyUrl(u) {
  let t = String(u || '').replace(/^https?:\/\//, '').split('?')[0].replace(/\$\{[^}]*\}/g, '…')
  const [host, ...path] = t.split('/')
  const segs = path.filter(Boolean)
  if (segs.length > 3) t = `${host}/${segs[0]}/…/${segs[segs.length - 1]}`
  return t.replace(/\/$/, '')
}

/** "clean_listings" -> "Cleans listings" */
export function describeName(name) {
  const ws = words(name)
  if (!ws.length) return String(name)
  if (VERBS.has(ws[0])) return cap([third(ws[0]), ...ws.slice(1)].join(' '))
  return cap(ws.join(' '))
}

const FILE_KIND = (p) => {
  const ext = P.extname(p).toLowerCase()
  return { '.json': 'JSON file', '.csv': 'CSV file', '.tsv': 'TSV file', '.db': 'SQLite file', '.sqlite': 'SQLite file', '.sqlite3': 'SQLite file', '.html': 'HTML page', '.htm': 'HTML page', '.txt': 'text file', '.md': 'Markdown file', '.xlsx': 'spreadsheet', '.xls': 'spreadsheet', '.parquet': 'Parquet file', '.pkl': 'pickle file', '.log': 'log file', '.xml': 'XML file', '.yaml': 'YAML file', '.yml': 'YAML file' }[ext] || 'file'
}
const OUTPUT_EXT = /\.(html?|pdf|md|xlsx?|png|svg|jpg|txt|log|csv)$/i

export function buildStory({ name, functions, fnById, callEdges, ops, http, routes, resources, fileRoles, entries, texts, stack, health, virtual }) {
  const isTest = (f) => fileRoles.get(f) === 'test'
  const linesOf = new Map()
  const codeAt = (file, line) => {
    if (!linesOf.has(file)) linesOf.set(file, (virtual.get(file) ?? texts.get(file) ?? '').split('\n'))
    return (linesOf.get(file)[line - 1] || '').trim().slice(0, 180)
  }
  const evidence = (file, line, note) => ({ file, line, code: codeAt(file, line), note })
  const fnText = (fn) => firstSentence(fn.doc) || describeName(fn.qual === '<main>' ? `run ${P.basename(fn.file)}` : fn.name)
  const opsOf = (fn) => fn.opIds.map((i) => ops[i])
  const routeById = new Map(routes.map((r) => [r.id, r]))

  const reach = (id, depth = 5) => {
    const seen = new Set([id])
    let frontier = [id]
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = []
      for (const f of frontier) for (const c of fnById.get(f)?.callees || []) if (!seen.has(c)) { seen.add(c); next.push(c) }
      frontier = next
    }
    return seen
  }
  const reachedOps = (id) => [...reach(id)].flatMap((f) => (fnById.get(f) ? opsOf(fnById.get(f)) : []))
  const reachedHttp = (id) => [...reach(id)].flatMap((f) => (fnById.get(f)?.httpIds || []).map((h) => http.find((x) => x.id === h)).filter(Boolean))

  // ---------- roots: where work starts ----------
  const roots = functions.filter((f) => !isTest(f.file) && (
    f.qual === '<main>' || f.kind === 'handler' || f.routeIds.length ||
    (fileRoles.get(f.file) === 'frontend' && f.httpIds.length) ||
    (f.qual === '<module>' && entries.has(f.file) && (f.opIds.length || f.callees.length)) ||
    opsOf(f).some((o) => o.cat === 'jobs')))
  // functions a script's __main__ hands everything to (main(), run(), pipeline()) start work too
  for (const r of roots.filter((x) => x.qual === '<main>' || x.qual === '<module>')) {
    for (const c of r.callees) {
      const f = fnById.get(c)
      if (f && !isTest(f.file) && f.callees.length >= 2 && !roots.includes(f)) roots.push(f)
    }
  }
  const rootSet = new Set(roots.map((r) => r.id))
  const runOrder = new Map()
  {
    const rank = (f) => (f.qual === '<main>' || f.qual === '<module>' ? 0 : f.kind === 'handler' || f.routeIds.length ? 1 : 2) * 100 + f.file.split('/').length
    let n = 0
    const visit = (id, depth) => {
      if (runOrder.has(id) || depth > 8) return
      runOrder.set(id, n++)
      const edges = (callEdges.get(id) || []).map((e, i) => ({ ...e, i })).sort((a, b) => a.line - b.line || b.i - a.i)
      for (const e of edges) visit(e.to, depth + 1)
    }
    for (const r of roots.slice().sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file) || a.line - b.line)) visit(r.id, 0)
  }
  const orderOf = (id) => runOrder.get(id) ?? 1e6

  // ---------- what each resource is for ----------
  const roleOf = (r) => {
    const files = r.files.filter((f) => !isTest(f))
    if (!files.length) return null
    if (r.kind === 'http') return r.key === 'http:(dynamic)' ? 'dynamic' : 'source'
    if (r.kind === 'web') return 'source'
    if (r.kind === 'llm') return 'ai'
    if (r.kind === 'dom') return 'ui'
    if (r.kind === 'storage') return 'ui-state'
    if (r.kind === 'db') return 'store'
    if (r.kind === 'file') {
      if (r.key === 'file:*') return null
      if (!r.writes) return 'source'
      if (!r.reads && OUTPUT_EXT.test(r.label)) return 'output'
      return 'store'
    }
    if (['email', 'realtime', 'payments'].includes(r.kind)) return 'output'
    return null
  }
  const res = [...resources.values()].map((r) => ({ ...r, role: roleOf(r) })).filter((r) => r.role)
  const fnsTouching = (r) => [...new Set(r.opIds.map((i) => ops[i].fnId).filter(Boolean))].map((id) => fnById.get(id)).filter((f) => f && !isTest(f.file))

  const stages = []
  const usedFns = new Set()

  // ---------- 1. Collect ----------
  {
    const cards = []
    const scrapeFns = functions.filter((f) => !isTest(f.file) && opsOf(f).some((o) => o.cat === 'scrape' && o.verb === 'select'))
    const writesInFn = (f) => opsOf(f).some((o) => o.rw === 'write')
    for (const r of res) {
      if (r.role === 'source' && r.kind === 'file' && /\.html?$/.test(r.label) && fnsTouching(r).some((f) => writesInFn(f) || f.callees.some((c) => fnById.get(c) && writesInFn(fnById.get(c))))) r.role = 'template'
    }
    const sources = res.filter((r) => r.role === 'source').sort((a, b) => (b.kind === 'web') - (a.kind === 'web') || (b.kind === 'http') - (a.kind === 'http') || b.opIds.length - a.opIds.length)
    for (const r of sources.slice(0, 4)) {
      const fns = fnsTouching(r)
      const op = ops[r.opIds.find((i) => !isTest(ops[i].file))]
      const kindLabel = r.kind === 'web' || (r.kind === 'http' && scrapeFns.length) ? 'website (scraped)' : r.kind === 'http' ? 'outside API' : r.kind === 'db' ? `${r.engine || 'database'} table` : FILE_KIND(r.label)
      let explain
      if (r.kind === 'web' || r.kind === 'http') {
        const urls = [...new Set(r.opIds.map((i) => ops[i].target).filter((t) => t && !t.startsWith('(')))]
        const where = urls.length ? list(urls.map(prettyUrl), 2) : r.label
        const by = fns.length ? ` with ${list(fns.map((f) => `${f.name}()`), 2)}` : ''
        explain = r.kind === 'web' ? `Opens pages on ${where}${by}.` : scrapeFns.length ? `Downloads the page at ${where}${by}, to be scraped.` : `Requests data from ${where}${by}.`
      } else if (r.kind === 'file') {
        explain = `${fns.length ? `${list(fns.map((f) => `${f.name}()`), 2)} reads` : 'Reads'} ${r.label}${/\.html?$/.test(r.label) ? ', a saved copy of the page, so the pipeline can run without the internet' : ' as input'}.`
      } else explain = `Reads from ${r.label}${fns.length ? ` in ${list(fns.map((f) => `${f.name}()`), 2)}` : ''}.`
      fns.forEach((f) => usedFns.add(f.id))
      const owner = /^(raw\.githubusercontent\.com|github\.com|api\.github\.com)$/.test(r.label) ? (op?.target || '').replace(/^https?:\/\/[^/]+\/(repos\/)?/, '').split('/')[0] : null
      cards.push({ title: owner && !owner.includes('$') ? `GitHub (${owner})` : r.label, kind: kindLabel, explain, fnIds: fns.map((f) => f.id), resourceKey: r.key, evidence: op ? [evidence(op.file, op.line, op.label)] : [] })
    }
    // runtime-built URLs: name them after their config variable or file
    const dyn = res.find((r) => r.role === 'dynamic')
    if (dyn && cards.filter((c) => c.kind !== 'user input').length < 2) {
      const byFile = new Map()
      for (const i of dyn.opIds) {
        const o = ops[i]
        if (isTest(o.file) || fileRoles.get(o.file) === 'frontend') continue
        if (!byFile.has(o.file)) byFile.set(o.file, [])
        byFile.get(o.file).push(o)
      }
      for (const [file, list_] of [...byFile].sort((a, b) => b[1].length - a[1].length).slice(0, Math.min(2, 4 - cards.length))) {
        const clientFns = [...new Set(list_.map((o) => o.fnId))].map((id) => fnById.get(id)).filter(Boolean)
        const exported = functions.filter((f) => f.file === file && f.exported && f.callers.some((c) => fnById.get(c)?.file !== file))
        const users = [...new Set(exported.flatMap((f) => f.callers.map((c) => fnById.get(c)?.file)).filter((x) => x && x !== file))]
        const fn = exported.sort((a, b) => b.callers.length - a.callers.length)[0] || clientFns[0]
        const via = users.length
        const base = (list_[0].target || '').match(/\$\{([^}]+)\}/)?.[1]
        const named = base && words(base).filter((w) => !/^(this|url|base|api|host|endpoint|uri|origin|config|env|process|self|path|root)$/.test(w)).map(cap).join(' ')
        const title = named ? `${named} API` : describeName(P.basename(file, P.extname(file)))
        fn && usedFns.add(fn.id)
        const names = exported.slice(0, 3).map((f) => `${f.name}()`)
        cards.push({ title, kind: 'outside API (URL from config)', explain: `${P.basename(file)} is the client for ${title.replace(/ API$/, '')}; its address comes from configuration.${names.length ? ` The rest of the app goes through ${list(names, 3)}${via ? `, used in ${plural(via, 'other file')}` : ''}.` : ''}`, fnIds: fn ? [fn.id] : [], evidence: [evidence(list_[0].file, list_[0].line, list_[0].label)] })
      }
    }
    if (scrapeFns.length) {
      const sels = scrapeFns.flatMap((f) => opsOf(f).filter((o) => o.cat === 'scrape' && o.verb === 'select').map((o) => o.target)).filter((s) => s && s.length < 40)
      const fields = [...new Set(scrapeFns.flatMap((f) => f.fields || []))]
      const top = scrapeFns.sort((a, b) => b.opIds.length - a.opIds.length)[0]
      top && usedFns.add(top.id)
      const selOps = opsOf(top).filter((o) => o.cat === 'scrape').slice(0, 3)
      cards.push({
        title: `${top.name}()`, kind: 'extracts the data',
        explain: `${fnText(top)}${/[.!?]$/.test(fnText(top)) ? '' : '.'} It looks for ${list(sels.map((s) => `\`${s}\``), 5)} in the HTML${fields.length ? ` and builds records with ${list(fields, 6)}` : ''}.`,
        fnIds: scrapeFns.slice(0, 3).map((f) => f.id), fields, evidence: selOps.map((o) => evidence(o.file, o.line, o.label)),
      })
    }
    // the frontend as a source: forms and pages that send data in
    const inbound = http.filter((h) => h.kind === 'route' && !isTest(h.file) && fileRoles.get(h.file) === 'frontend' && /^(POST|PUT|PATCH)$/.test(h.method))
    if (inbound.length && cards.length < 4) {
      const files = [...new Set(inbound.map((h) => h.file))]
      cards.push({ title: 'People using the app', kind: 'user input', explain: `Users submit data from ${list(files.map((f) => P.basename(f)), 3)}, which sends it to ${list(inbound.map((h) => `${h.method} ${routeById.get(h.routeId)?.path}`), 3)}.`, fnIds: [], evidence: inbound.slice(0, 2).map((h) => evidence(h.file, h.line, `${h.method} ${h.resolvedUrl}`)) })
    }
    if (cards.length) {
      const main = cards[0]
      const headline = sources[0]?.kind === 'web' || scrapeFns.length ? `Scrapes ${sources.find((s) => s.kind === 'web' || s.kind === 'http')?.label || 'web pages'}`
        : sources[0]?.kind === 'http' ? `Pulls data from ${list(cards.filter((c) => c.kind === 'outside API').map((c) => c.title), 2)}`
          : main.kind.startsWith('outside API') ? `Pulls data from ${main.title}`
            : main.kind === 'user input' ? 'Takes input from users'
              : `Reads ${main.title}`
      stages.push({ id: 'collect', title: 'Collect', headline, cards })
    }
  }

  // ---------- 2. Process ----------
  {
    const candidates = []
    for (const f of functions) {
      if (isTest(f.file) || usedFns.has(f.id) || ['<module>', '<main>'].includes(f.qual) || ['handler', 'component', 'hook', 'repository', 'constructor'].includes(f.kind)) continue
      if (fileRoles.get(f.file) === 'frontend') continue
      const own = opsOf(f)
      const io = own.some((o) => ['http', 'scrape', 'db', 'file', 'storage', 'email', 'dom', 'process', 'payments', 'realtime'].includes(o.cat))
      const transform = own.filter((o) => o.cat === 'transform')
      const llm = own.filter((o) => o.cat === 'llm')
      const fromRoot = f.callers.some((c) => rootSet.has(c))
      if (!(llm.length || transform.length || (fromRoot && !io))) continue
      if (f.kind === 'method' && /^__/.test(f.name)) continue
      let s = 0
      if (fromRoot) s += 3
      if (transform.length) s += 2
      if (llm.length) s += 4
      if (f.doc) s += 2
      if (DATA_VERB.test(f.name.replace(/^_+/, ''))) s += 2
      if (f.fields?.length) s += 1
      s += Math.min(3, f.callers.length)
      if (f.endLine - f.line < 3) s -= 3
      if (GENERIC.test(f.name)) s -= 3
      if (/config|settings|options|setup|init|register|routes?$|schema|types?$|constants?|args|argv|cli|usage|^list_|^load_|profiles?$|sources$|^log/i.test(f.name)) s -= 4
      if (!(f.params || []).filter((p) => !/^(self|cls)$/.test(p.name)).length && !llm.length) s -= 3 // pure steps take data in
      if (s >= 4) candidates.push({ f, s, transform, llm })
    }
    candidates.sort((a, b) => b.s - a.s)
    const picked = candidates.slice(0, 4).sort((a, b) => orderOf(a.f.id) - orderOf(b.f.id))
    const cards = picked.map(({ f, transform, llm }) => {
      usedFns.add(f.id)
      const t = fnText(f)
      const extra = llm.length ? ` It sends the data to ${list(llm.map((o) => o.lib), 2)}${llm[0].target && llm[0].target !== llm[0].lib ? ` (${llm[0].target})` : ''}.`
        : transform.length ? ` Uses ${list([...new Set(transform.map((o) => o.verb))], 4)}.` : ''
      const ev = (llm.length ? llm : transform).slice(0, 2).map((o) => evidence(o.file, o.line, o.label))
      if (!ev.length) {
        // the lines that do the work: building records, converting, de-duplicating, aggregating
        const WORK = /\b(append|push|extend|add|update|sort|sorted|filter|map|reduce|sum|round|min|max|mean|avg|set|strip|trim|lower|upper|replace|sub|split|join|float|int|parseFloat|parseInt|Number|dedupe|seen|merge|group|count|len|length)\b|\{\s*["'\w]+\s*:/g
        const body = []
        for (let ln = (f.defLine || f.line) + 1; ln <= f.endLine; ln++) {
          const code = codeAt(f.file, ln)
          if (!code || /^(#|\/\/|\*|\/\*|["']{3}|["'])/.test(code) || code.length < 12) continue
          const hits = (code.match(WORK) || []).length
          if (hits) body.push({ ln, hits, code })
        }
        body.sort((a, b) => b.hits - a.hits || a.ln - b.ln)
        for (const b of body.slice(0, 2).sort((a, c) => a.ln - c.ln)) ev.push(evidence(f.file, b.ln))
        if (!ev.length) ev.push(evidence(f.file, f.defLine || f.line, 'definition'))
      }
      const where = fileRoles.get(f.file) === 'backend' && !f.callers.some((c) => fnById.get(c)?.qual === '<main>') ? ' (on the server)' : ''
      return { title: `${f.name}()`, kind: (llm.length ? 'AI step' : 'transforms the data') + where, explain: `${sentence(t)}${extra}`, fnIds: [f.id], fields: f.fields || [], evidence: ev }
    })
    // AI services that weren't covered by a card
    for (const r of res.filter((x) => x.role === 'ai')) {
      if (cards.some((c) => c.kind === 'AI step' && c.explain.includes(r.label))) continue
      if (cards.length >= 5) break
      const fns = fnsTouching(r)
      const op = ops[r.opIds[0]]
      cards.push({ title: r.label, kind: 'AI service', explain: `Calls ${r.label}${op?.target && op.target !== r.label ? ` (${op.target})` : ''} from ${list(fns.map((f) => `${f.name}()`), 2)}.`, fnIds: fns.map((f) => f.id), evidence: op ? [evidence(op.file, op.line, op.label)] : [] })
    }
    if (cards.length) {
      const hasAI = cards.some((c) => c.kind.startsWith('AI'))
      const HEAD = /^(clean|parse|transform|normali[sz]e|process|analy[sz]e|summari[sz]e|compute|calculate|aggregate|filter|rank|score|format|enrich|dedupe|merge|validate|classify|extract|group|sort|predict|train|evaluate|combine|match|detect|count|estimate)$/
      const verbsUsed = cards.filter((c) => !c.kind.startsWith('AI')).map((c) => words(c.title.replace(/\(\)$/, ''))[0]).filter((w) => HEAD.test(w))
      const vs = [...new Set(verbsUsed)].slice(0, 3)
      const steps = cards.filter((c) => c.kind !== 'AI service').slice(0, 2).map((c) => `${c.title}: ${c.explain.charAt(0).toLowerCase()}${c.explain.slice(1).replace(/[.!?]$/, '')}`)
      const aiNames = cards.filter((c) => c.kind === 'AI service').map((c) => c.title)
      const lead = steps.length ? `${steps.join('; then ')}${aiNames.length ? `; it calls ${list(aiNames, 2)}` : ''}.` : null
      stages.push({ id: 'process', lead, title: hasAI ? 'Process & AI' : 'Process', headline: vs.length ? cap(list(vs.map((v) => (v.endsWith('e') ? v.slice(0, -1) : v) + 'ing'), 3)) + (hasAI ? ', with AI' : '') : hasAI ? 'Runs it through AI' : 'Transforms the data', verbs: vs, hasAI, cards })
    }
  }

  // ---------- 3. Store ----------
  {
    const stores = res.filter((r) => r.role === 'store')
    const dbs = stores.filter((r) => r.kind === 'db')
    const cards = []
    const sqlCols = (r) => {
      const cols = new Set()
      for (const i of r.opIds) {
        const sql = ops[i].sql || ''
        const create = sql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?\w+[`"\]]?\s*\(([\s\S]+)\)/i)
        if (create) for (const part of create[1].split(',')) { const c = part.trim().match(/^[`"[]?(\w+)/)?.[1]; if (c && !/^(primary|foreign|unique|constraint|check|key)$/i.test(c)) cols.add(c) }
        const ins = sql.match(/insert\s+(?:or\s+\w+\s+)?into\s+\w+\s*\(([^)]+)\)/i)
        if (ins) for (const c of ins[1].split(',')) cols.add(c.trim().replace(/[`"[\]]/g, ''))
      }
      return [...cols].slice(0, 10)
    }
    const describeStore = (r) => {
      const fns = fnsTouching(r)
      const writers = fns.filter((f) => opsOf(f).some((o) => o.resource?.key === r.key && o.rw === 'write'))
      const readers = fns.filter((f) => opsOf(f).some((o) => o.resource?.key === r.key && o.rw !== 'write'))
      // how data arrives: routes whose handlers reach a writer, and who calls those routes
      const viaRoutes = routes.filter((rt) => rt.handlerId && writers.some((w) => reach(rt.handlerId).has(w.id)))
      const callers = viaRoutes.flatMap((rt) => rt.callerIds.map((h) => http.find((x) => x.id === h))).filter(Boolean)
      const fields = sqlCols(r)
      fns.forEach((f) => usedFns.add(f.id))
      const called = viaRoutes.filter((v) => v.callerIds.length)
      const arrive = called.length ? called : viaRoutes
      let explain = r.kind === 'db' ? `The ${r.label} table${r.engine ? ` (${r.engine})` : ''} is where this data lives.` : `The data is kept in ${r.label}, a ${FILE_KIND(r.label)}.`
      if (arrive.length) {
        const who = [...new Set(arrive.flatMap((v) => v.callerIds).map((h) => http.find((x) => x.id === h)).filter(Boolean).map((c) => P.basename(c.file)))]
        explain += ` New data arrives through ${list(arrive.map((v) => `${v.method} ${v.path}`), 2)}${who.length ? `, which ${list(who, 2)} calls` : ''}`
        explain += writers.length ? `, and ${list(writers.map((w) => `${w.name}()`), 2)} ${agree(writers, 'write')} it.` : '.'
      } else if (writers.length) explain += ` ${list(writers.map((w) => `${w.name}()`), 2)} ${agree(writers, 'write')} it.`
      if (readers.length) explain += ` ${list(readers.map((x) => `${x.name}()`), 3)} ${agree(readers, 'read')} it back.`
      const op = ops[r.opIds.find((i) => ops[i].rw === 'write') ?? r.opIds[0]]
      return { title: r.label, kind: r.kind === 'db' ? `${r.engine || 'database'} table` : r.kind === 'file' ? FILE_KIND(r.label) : r.kind, explain, fnIds: fns.map((f) => f.id), fields, resourceKey: r.key, evidence: op ? [evidence(op.file, op.line, op.label)] : [], routeIds: viaRoutes.map((v) => v.id) }
    }
    if (dbs.length > 3) {
      const engine = dbs.find((d) => d.engine)?.engine || 'Database'
      const busiest = dbs.slice().sort((a, b) => b.opIds.length - a.opIds.length)
      cards.push({ title: `${engine} database`, kind: `${dbs.length} tables`, explain: `Keeps its data in ${plural(dbs.length, 'table')}: ${list(busiest.map((d) => d.label), 6)}. The busiest is ${busiest[0].label} (${plural(busiest[0].opIds.length, 'query', 'queries')}).`, fnIds: [], evidence: busiest.slice(0, 2).map((d) => ops[d.opIds[0]]).map((o) => evidence(o.file, o.line, o.label)) })
      for (const d of busiest.slice(0, 2)) cards.push(describeStore(d))
    } else for (const r of dbs) cards.push(describeStore(r))
    for (const r of stores.filter((x) => x.kind === 'file').sort((a, b) => b.opIds.length - a.opIds.length).slice(0, Math.max(0, 4 - cards.length))) cards.push(describeStore(r))
    if (cards.length) {
      const first = stores.sort((a, b) => b.opIds.length - a.opIds.length)[0]
      stages.push({ id: 'store', title: 'Store', headline: dbs.length > 1 ? `Saves to a ${dbs[0].engine || ''} database`.replace('  ', ' ') : `Saves to ${first.label}`, cards })
    }
  }

  // ---------- 4. Serve ----------
  {
    const live = routes.filter((r) => !isTest(r.file))
    if (live.length) {
      const describeRoute = (r) => {
        const h = r.handlerId && !r.handlerApprox ? fnById.get(r.handlerId) : null
        if (h?.doc && h.kind !== 'handler') return firstSentence(h.doc)
        const reached = h ? reachedOps(h.id) : []
        const writes = reached.filter((o) => o.rw === 'write' && o.resource)
        const reads = reached.filter((o) => o.rw !== 'write' && o.resource && ['db', 'file'].includes(o.resource.kind))
        const llm = reached.find((o) => o.cat === 'llm')
        const out = reached.find((o) => o.cat === 'http' && o.resource)
        if (llm) return `Asks ${llm.lib} and returns the answer`
        if (/^(POST|PUT|PATCH)$/.test(r.method) && writes.length) return `Saves to ${writes[0].resource.label}`
        if (r.method === 'DELETE' && writes.length) return `Deletes from ${writes[0].resource.label}`
        if (reads.length) {
          const compute = h && [...reach(h.id)].map((id) => fnById.get(id)).find((f) => f && f.id !== h.id && DATA_VERB.test(f.name) && !f.opIds.length)
          return compute ? `Reads ${reads[0].resource.label} and ${describeName(compute.name).toLowerCase()}` : `Returns data from ${reads[0].resource.label}`
        }
        if (out) return `Fetches from ${out.resource.label}`
        if (h && h.kind !== 'handler') return describeName(h.name)
        return null
      }
      const important = live.slice().sort((a, b) => b.callerIds.length - a.callerIds.length || (a.method === 'GET' ? -1 : 1))
      const tidy = (p) => p.replace(/^\/?\$\{[^}]+\}/, '/…')
      const items = important.map((r) => ({ routeId: r.id, method: r.method, path: tidy(r.path), says: describeRoute(r), callers: r.callerIds.length }))
      const frameworks = [...new Set(live.map((r) => r.framework))]
      const groups = new Map()
      for (const it of items) {
        const k = '/' + (it.path.split('/').filter((x) => x && !/^(:|\$|\{|<|\*)/.test(x) && x !== 'api')[0] || '')
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k).push(it)
      }
      const callersOf = (its) => its.reduce((n, i) => n + i.callers, 0)
      const cards = [...groups].sort((a, b) => callersOf(b[1]) - callersOf(a[1]) || b[1].length - a[1].length).slice(0, 4).map(([k, its]) => ({
        title: its.length === 1 ? `${its[0].method} ${its[0].path}` : `${k} endpoints`, kind: plural(its.length, 'endpoint'),
        explain: its.length === 1 ? sentence(its[0].says || 'Handles requests') : `${plural(its.length, 'endpoint')} under ${k}${(() => { const r = its.map((i) => (i.says || '').match(/(?:from|to) (\S+)$/)?.[1]).filter(Boolean); const top = r.sort((a, b) => r.filter((x) => x === b).length - r.filter((x) => x === a).length)[0]; return top ? `, mostly working with ${top}` : '' })()}.`,
        routes: its.slice(0, 8), fnIds: its.map((i) => routeById.get(i.routeId).handlerId).filter(Boolean).slice(0, 6),
        evidence: its.slice(0, 2).map((i) => { const r = routeById.get(i.routeId); return evidence(r.file, r.line, `${r.method} ${r.path}`) }),
      }))
      const fw = frameworks.map((f) => ({ express: 'Express', fastapi: 'FastAPI', flask: 'Flask', django: 'Django', spring: 'Spring', nest: 'NestJS', next: 'Next.js', custom: 'a hand-written router', sveltekit: 'SvelteKit', nuxt: 'Nuxt', 'flask-restful': 'Flask-RESTful' }[f] || f))
      const lowerSays = (t) => (t ? ` (${t.charAt(0).toLowerCase()}${t.slice(1).replace(/[.!?]$/, '')})` : '')
      const lead = `${plural(live.length, 'endpoint')} built with ${list(fw, 2)}; the main ones are ${list(items.slice(0, 3).map((i) => `${i.method} ${i.path}${lowerSays(i.says)}`), 3)}.`
      stages.push({ id: 'serve', lead, title: 'Serve', headline: `${plural(live.length, 'API endpoint')} (${list(fw, 2)})`, cards, routeCount: live.length })
    }
  }

  // ---------- 5. Show / deliver ----------
  {
    const cards = []
    const uiFiles = new Map()
    for (const h of http) {
      if (h.kind !== 'route' || isTest(h.file) || fileRoles.get(h.file) !== 'frontend') continue
      if (!uiFiles.has(h.file)) uiFiles.set(h.file, new Set())
      uiFiles.get(h.file).add(h.routeId)
    }
    const pageTitle = (file) => {
      for (const [p, t] of texts) {
        if (!/\.html?$/.test(p) || !t.includes(P.basename(file))) continue
        const title = t.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim()
        if (title) return `${title} page`
      }
      const fns = functions.filter((f) => f.file === file)
      const comp = fns.find((f) => f.kind === 'component' && f.exported)
      if (comp) return describeName(comp.name).replace(/^(\w)/, (m) => m.toUpperCase())
      const htmlTitle = (texts.get(file) || '').match(/<title>([^<]+)<\/title>/i)?.[1]
      return htmlTitle || P.basename(file)
    }
    for (const [file, rids] of [...uiFiles].sort((a, b) => b[1].size - a[1].size).slice(0, 3)) {
      const rs = [...rids].map((id) => routeById.get(id)).filter(Boolean)
      const fn = functions.find((f) => f.file === file && f.httpIds.length)
      const writesDom = functions.some((f) => f.file === file && opsOf(f).some((o) => o.cat === 'dom'))
      const doc = functions.find((f) => f.file === file && f.doc)?.doc
      cards.push({
        title: pageTitle(file), kind: 'screen in the browser',
        explain: `${doc ? sentence(firstSentence(doc)) + ' ' : ''}Calls ${list(rs.map((r) => `${r.method} ${r.path}`), 3)}${writesDom ? ' and puts the results on the page' : ''}.`,
        fnIds: functions.filter((f) => f.file === file && f.httpIds.length).map((f) => f.id).slice(0, 4),
        evidence: fn ? fn.httpIds.slice(0, 2).map((id) => http.find((h) => h.id === id)).filter(Boolean).map((h) => evidence(h.file, h.line, `${h.method} ${h.resolvedUrl}`)) : [],
        file,
      })
    }
    const moreUi = uiFiles.size - cards.length
    const templates = res.filter((x) => x.role === 'template')
    for (const r of res.filter((x) => x.role === 'output').slice(0, 4 - cards.length)) {
      const fns = fnsTouching(r)
      const op = ops[r.opIds[0]]
      const tpl = /\.html?$/.test(r.label) ? templates[0] : null
      cards.push({ title: r.label, kind: r.kind === 'file' ? `generated ${FILE_KIND(r.label)}` : r.kind, explain: r.kind === 'file' ? `${list(fns.map((f) => `${f.name}()`), 2)} ${agree(fns, 'build')} ${r.label}${tpl ? ` from the ${tpl.label} template` : ''}${/\.html?$/.test(r.label) ? ', a page you open in the browser' : ''}.` : `${list(fns.map((f) => `${f.name}()`), 2)} ${r.kind === 'email' ? 'sends emails' : r.kind === 'payments' ? 'takes payments through ' + r.label : 'pushes live updates'}.`, fnIds: fns.map((f) => f.id), evidence: op ? [evidence(op.file, op.line, op.label)] : [], resourceKey: r.key })
    }
    if (!cards.length) {
      // frontends that only read the page or browser storage
      const ui = res.find((r) => r.role === 'ui')
      if (ui) {
        const fns = fnsTouching(ui)
        cards.push({ title: 'The web page', kind: 'browser', explain: `${list([...new Set(fns.map((f) => P.basename(f.file)))], 3)} work directly with the page.`, fnIds: fns.slice(0, 4).map((f) => f.id), evidence: [] })
      }
    }
    if (cards.length) {
      const screens = uiFiles.size
      stages.push({ id: 'show', title: screens ? 'Show' : 'Deliver', headline: screens ? `${plural(screens, 'screen')} in the browser` : `Produces ${cards[0].title}`, cards, more: moreUi > 0 ? moreUi : 0 })
    }
  }

  // ---------- summary, built-with, talking points ----------
  const S = Object.fromEntries(stages.map((s) => [s.id, s]))
  const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1)
  let first = S.collect ? lower(S.collect.headline) : null
  if (S.process) {
    const vs = (S.process.verbs || []).map(third)
    const ai = (S.process.cards || []).filter((c) => c.kind.startsWith('AI')).map((c) => c.kind === 'AI service' ? c.title : null).filter(Boolean)
    const proc = vs.length ? `${list(vs, 3)} the data${S.process.hasAI ? ' and uses AI' + (ai.length ? ` (${list(ai, 2)})` : '') : ''}` : S.process.hasAI ? `runs it through AI${ai.length ? ` (${list(ai, 2)})` : ''}` : 'transforms the data'
    first = first ? `${first}, then ${proc}` : proc
  }
  const rest = []
  if (S.store) rest.push(lower(S.store.headline).replace(/^saves to/, 'saves the results to').replace(/^saves to a/, 'saves the results to a'))
  if (S.serve) rest.push(`serves them through ${plural(S.serve.routeCount, 'API endpoint')}`)
  if (S.show) {
    const screens = S.show.cards.filter((c) => c.kind.startsWith('screen')).length + (S.show.more || 0)
    rest.push(S.show.title === 'Show' ? (screens === 1 ? 'shows them on a web page' : `shows them across ${screens} browser screens`) : `produces ${S.show.cards[0].title}`)
  }
  const summary = !first && !rest.length
    ? `${name}: no clear data pipeline was found. It may be a library, a static site, or code this tool can't parse yet.`
    : `${name} ${first || 'works with its data'}.${rest.length ? ` It ${list(rest, 4)}.` : ''}`

  const builtWith = []
  const tech = (cat) => stack.technologies.filter((t) => t.known && t.category === cat).map((t) => t.label)
  const langs = stack.languages.filter((l) => !['html', 'css', 'scss', 'less', 'shell', 'batch', 'powershell'].includes(l.lang)).slice(0, 3).map((l) => ({ javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', java: 'Java', kotlin: 'Kotlin', go: 'Go', notebook: 'Jupyter' }[l.lang] || l.lang))
  for (const [cat, label] of [['Frontend framework', 'frontend'], ['Backend framework', 'backend'], ['Scraping & browser automation', 'scraping'], ['Database & ORM', 'database'], ['AI / LLM', 'AI'], ['Data & analysis', 'data']]) {
    const t = tech(cat)
    if (t.length) builtWith.push({ role: label, tech: t.slice(0, 3) })
  }

  const talking = [summary]
  for (const s of stages) {
    talking.push(`${s.title}: ${s.lead || s.cards[0].explain}`)
  }
  const shapeCard = [...(S.process?.cards || []), ...(S.collect?.cards || []), ...(S.store?.cards || [])].find((c) => c.fields?.length >= 2)
  if (shapeCard) talking.push(`Each record carries ${list(shapeCard.fields, 8)}.`)
  if (builtWith.length) talking.push(`Built with ${list(builtWith.map((b) => `${list(b.tech, 2)} (${b.role})`), 5)}${langs.length ? `, written in ${list(langs, 3)}` : ''}.`)

  const caveats = []
  for (const hid of health.unmatchedCalls.slice(0, 2)) {
    const h = http.find((x) => x.id === hid)
    const sug = h?.suggestions?.[0] ? routeById.get(h.suggestions[0].routeId) : null
    if (h) caveats.push(`${P.basename(h.file)} calls ${h.method} ${h.path}, which no route serves${sug ? `; it probably means ${sug.method} ${sug.path}` : ''}. That request fails at runtime.`)
  }
  if (health.secrets.length) caveats.push(`${plural(health.secrets.length, 'possible secret')} (API keys, passwords) ${health.secrets.length === 1 ? 'is' : 'are'} written straight into the code.`)
  if (health.envFileNotIgnored) caveats.push(`${health.envFileNotIgnored} isn't excluded by .gitignore, so secrets could get committed.`)
  if (health.counts.identicalDuplicates) caveats.push(`${plural(health.counts.identicalDuplicates, 'function')} ${health.counts.identicalDuplicates === 1 ? 'is' : 'are'} copy-pasted between files, so a fix in one place can miss the other.`)
  if (health.undocumentedEnv.length) caveats.push(`It needs ${plural(health.undocumentedEnv.length, 'environment variable')} that no .env file documents (${list(health.undocumentedEnv, 3)}).`)

  // ---------- side paths: routes and jobs outside the main story ----------
  const shownRoutes = new Set((S.serve?.cards || []).flatMap((c) => (c.routes || []).map((r) => r.routeId)))
  const sidePaths = routes.filter((r) => !isTest(r.file) && !shownRoutes.has(r.id)).slice(0, 6).map((r) => ({ routeId: r.id, text: `${r.method} ${r.path}` }))
  for (const f of functions) if (!isTest(f.file) && opsOf(f).some((o) => o.cat === 'jobs')) sidePaths.push({ fnId: f.id, text: `${describeName(f.name)} runs on a schedule` })
  for (const f of functions) if (!isTest(f.file) && opsOf(f).some((o) => o.cat === 'auth') && f.kind !== 'handler') { sidePaths.push({ fnId: f.id, text: `${describeName(f.name)} handles login / tokens` }); break }

  // ---------- proof plan: run the main script's steps on safe inputs ----------
  const proof = buildProofPlan({ functions, fnById, callEdges, ops, http, isTest, reach, reachedOps, reachedHttp, fnText, stages, texts, virtual })

  // which stage each function belongs to (for attaching proof results)
  const stageOfFn = {}
  for (const s of stages) for (const c of s.cards) for (const id of c.fnIds || []) stageOfFn[id] ||= s.id

  return { summary, builtWith, languages: langs, stages, talking, caveats, sidePaths: sidePaths.slice(0, 8), proof, stageOfFn }
}

function buildProofPlan({ functions, fnById, callEdges, ops, http, isTest, reach, reachedOps, reachedHttp, fnText, texts, virtual }) {
  const mains = functions.filter((f) => !isTest(f.file) && (f.qual === '<main>' || (f.qual === '<module>' && f.runnable?.mode === 'script')))
  if (!mains.length) return null
  const score = (f) => [...reach(f.id)].length + reachedOps(f.id).length * 2
  const depthOf = (f) => f.file.split('/').length
  let root = mains.sort((a, b) => depthOf(a) - depthOf(b) || score(b) - score(a))[0]
  for (let i = 0; i < 2; i++) {
    const kids = root.callees.map((c) => fnById.get(c)).filter((f) => f && !isTest(f.file))
    if (kids.length === 1 && kids[0].callees.length >= 2) root = kids[0]
    else break
  }
  // execution order: by line; on the same line the call recorded later is the inner one, which runs first
  const edges = (callEdges.get(root.id) || []).map((e, i) => ({ ...e, i })).sort((a, b) => a.line - b.line || b.i - a.i)
  const steps = []
  const seen = new Set()
  const rootLines = (virtual.get(root.file) ?? texts.get(root.file) ?? '').split('\n').slice(root.line - 1, root.endLine).join('\n')
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // which earlier step feeds this argument? clean(parse(html)) or listings = clean(...); summarize(listings)
  const feeder = (argText) => {
    if (!argText) return null
    const done = steps.filter((s) => s.input)
    for (const s of done.slice().reverse()) {
      const nm = fnById.get(s.fnId).name
      if (new RegExp(`\\b${esc(nm)}\\s*\\(`).test(argText)) return s.fnId
      if (/^[A-Za-z_$][\w$]*$/.test(argText.trim()) && new RegExp(`\\b${esc(argText.trim())}\\s*=[^=\\n][^\\n]*\\b${esc(nm)}\\s*\\(`).test(rootLines)) return s.fnId
    }
    return null
  }
  for (const e of edges) {
    const fn = fnById.get(e.to)
    if (!fn || seen.has(fn.id) || isTest(fn.file)) continue
    seen.add(fn.id)
    const params = (fn.params || []).filter((p) => !/^(self|cls)$/.test(p.name))
    const required = params.filter((p) => p.default === undefined && !p.rest && !p.kwargs && !String(p.name).startsWith('{'))
    const reached = reachedOps(fn.id)
    const reachedCalls = reachedHttp(fn.id)
    const writes = reached.filter((o) => o.rw === 'write' || ['email', 'payments', 'process'].includes(o.cat) || (o.cat === 'db' && /^(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP)/i.test(o.verb || '')))
    const sends = reachedCalls.filter((h) => !/^(GET|HEAD)$/.test(h.method))
    const network = reached.some((o) => (o.cat === 'http' && o.resource) || (o.cat === 'scrape' && o.verb === 'load') || o.cat === 'llm')
    const step = { fnId: fn.id, label: fn.qual, does: fnText(fn), line: e.line, network }
    if (fn.kind === 'constructor' || fn.qual.includes('.')) continue
    if (!fn.runnable?.ok) step.skip = fn.runnable?.reason || 'cannot run on its own'
    else if (writes.length || sends.length) step.skip = `changes things (${writes[0]?.label || `${sends[0].method} ${sends[0].resolvedUrl}`}), so it is left out of the safe run`
    else if (required.length === 0) step.input = 'none'
    else if (required.length === 1) {
      const idx = params.indexOf(required[0])
      const from = feeder(e.argText?.[idx] ?? e.argText?.[0])
      if (from) { step.input = 'from'; step.from = from }
      else step.skip = `needs an input (${required[0].name}) that this tool can't supply on its own`
    } else step.skip = `needs ${plural(required.length, 'input')} (${required.map((p) => p.name).join(', ')})`
    steps.push(step)
  }
  // prefer the offline source when the script picks between live and saved data on one line
  for (const s of steps) {
    const offline = s.input === 'none' && s.network && steps.find((o) => o !== s && o.line === s.line && o.input === 'none' && !o.network)
    if (offline) {
      delete s.input
      s.skip = 'uses the internet; the saved copy on the same line is used instead'
      for (const t of steps) if (t.from === s.fnId) t.from = offline.fnId
    }
  }
  const runnable = steps.filter((s) => s.input)
  if (runnable.length < 2) return { rootFnId: root.id, rootLabel: root.qual, steps, canRun: false }
  return { rootFnId: root.id, rootLabel: root.qual === '<main>' ? `${P.basename(root.file)}` : `${root.qual}()`, rootFile: root.file, steps, canRun: true }
}
