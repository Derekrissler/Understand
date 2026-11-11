// Java extractor (structural parse, no external parser). Strong on Spring:
// controllers and mappings, injected fields, repositories, RestTemplate/WebClient,
// JdbcTemplate, mail, messaging, scheduling, Jsoup scraping.
import { parseUrl, hostResource, sqlInfo, sqlVerbKind, fileResource, dbResource, shortSel } from './ops.js'

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'else', 'try', 'do', 'throw', 'case', 'assert', 'super', 'this', 'class', 'instanceof', 'default'])
const REPO_BASES = /\b(JpaRepository|CrudRepository|MongoRepository|PagingAndSortingRepository|ReactiveCrudRepository|ReactiveMongoRepository|ListCrudRepository|ElasticsearchRepository|R2dbcRepository)\s*<\s*([\w.]+)/
const MAPPINGS = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH', RequestMapping: 'ANY', MessageMapping: 'WS', SubscribeMapping: 'WS' }

/** Blank out comments (and, for `structural`, string contents) keeping offsets and newlines. */
export function maskJava(code) {
  const n = code.length
  const noComments = code.split('')
  const structural = code.split('')
  let i = 0
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') { noComments[i] = structural[i] = ' '; i++ }
    } else if (c === '/' && d === '*') {
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] !== '\n') noComments[i] = structural[i] = ' '
        i++
      }
      if (i < n) { noComments[i] = structural[i] = ' '; noComments[i + 1] = structural[i + 1] = ' '; i += 2 }
    } else if (c === '"' && code.slice(i, i + 3) === '"""') {
      i += 3
      while (i < n && code.slice(i, i + 3) !== '"""') { if (code[i] !== '\n') structural[i] = ' '; i++ }
      i += 3
    } else if (c === '"' || c === "'") {
      const q = c
      i++
      while (i < n && code[i] !== q && code[i] !== '\n') {
        if (code[i] === '\\') { structural[i] = ' '; i++ }
        structural[i] = ' '
        i++
      }
      i++
    } else i++
  }
  return { noComments: noComments.join(''), structural: structural.join('') }
}

function matchBrace(s, open) {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') { depth--; if (depth === 0) return i }
  }
  return s.length - 1
}

function strings(s) {
  return [...s.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1])
}

function annotationsIn(seg) {
  const out = []
  const re = /@([\w.]+)\s*(\(([^()]*(?:\([^()]*\)[^()]*)*)\))?/g
  let m
  while ((m = re.exec(seg))) out.push({ name: m[1].split('.').pop(), args: m[3] ?? null })
  return out
}

function mappingPaths(args) {
  if (args == null || !args.trim()) return ['']
  const named = args.match(/\b(?:value|path)\s*=\s*(\{[^}]*\}|"(?:[^"\\]|\\.)*")/)
  if (named) return strings(named[1])
  const t = args.trim()
  if (t.startsWith('"') || t.startsWith('{')) {
    const first = t.startsWith('{') ? t.slice(0, t.indexOf('}') + 1) : t.match(/^"(?:[^"\\]|\\.)*"/)[0]
    return strings(first)
  }
  return ['']
}

function joinPath(a, b) {
  const s = '/' + [a, b].map((x) => (x || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')
  return s
}

const baseType = (t) => (t || '').replace(/<.*$/s, '').replace(/\[\]$/, '').split('.').pop().trim()

export function extractJava(code, file) {
  const out = {
    imports: [], exports: [], functions: [], calls: [], http: [], routes: [], mounts: [], ops: [],
    consts: {}, env: [], ports: [], errors: [], pkgs: [], classes: [], package: null, typeRefs: [],
  }
  const { noComments, structural } = maskJava(code)
  const nl = []
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') nl.push(i)
  const lineAt = (idx) => {
    let lo = 0, hi = nl.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid }
    return lo + 1
  }
  const depthAt = new Int32Array(structural.length + 1)
  {
    let d = 0
    for (let i = 0; i < structural.length; i++) {
      depthAt[i] = d
      if (structural[i] === '{') d++
      else if (structural[i] === '}') d--
    }
  }
  const total = nl.length + 1
  out.functions.push({ name: '<module>', qual: '<module>', line: 1, endLine: total, kind: 'module', params: [] })

  out.package = noComments.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] ?? null
  for (const m of noComments.matchAll(/\bimport\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/g)) {
    out.imports.push({ source: m[2], static: !!m[1], wildcard: m[2].endsWith('.*'), names: [], line: lineAt(m.index) })
    out.pkgs.push(m[2].split('.').slice(0, 2).join('.'))
  }
  out.pkgs = [...new Set(out.pkgs)]
  out.typeRefs = [...new Set([...structural.matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1]))].slice(0, 800)
  const imported = new Set(out.imports.map((i) => i.source))
  const importsPkg = (p) => out.imports.some((i) => i.source.startsWith(p))

  const segBefore = (idx) => {
    let j = idx - 1
    while (j >= 0 && !';{}'.includes(structural[j])) j--
    return { text: noComments.slice(j + 1, idx), start: j + 1 }
  }
  const javadoc = (idx) => {
    const before = code.slice(Math.max(0, idx - 2000), idx)
    const m = before.match(/\/\*\*([\s\S]*?)\*\/\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*$/)
    if (!m) return null
    return m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter((l) => l && !l.startsWith('@')).join(' ').slice(0, 240) || null
  }

  // ---------- classes ----------
  const classRe = /\b(class|interface|enum|record|@interface)\s+([A-Z]\w*)([^{;]*)\{/g
  let cm
  const classes = []
  while ((cm = classRe.exec(structural))) {
    const open = cm.index + cm[0].length - 1
    const close = matchBrace(structural, open)
    const header = noComments.slice(cm.index, open)
    const pre = segBefore(cm.index)
    const annotations = annotationsIn(pre.text)
    const ext = header.match(/\bextends\s+([\w.<>,\s?]+?)(?=\bimplements\b|\(|$)/)?.[1]?.trim() ?? null
    const impl = header.match(/\bimplements\s+([\w.<>,\s?]+)$/)?.[1]?.trim() ?? null
    const repo = (header.match(REPO_BASES) || [])[2]
    const cls = {
      name: cm[2], kind: cm[1], line: lineAt(pre.start + (pre.text.length - pre.text.trimStart().length)), endLine: lineAt(close),
      open, close, depth: depthAt[open], extends: ext, implements: impl, annotations: annotations.map((a) => a.name),
      repositoryOf: repo ? baseType(repo) : null, doc: javadoc(pre.start + (pre.text.length - pre.text.trimStart().length)),
      fields: {},
    }
    const mapping = annotations.find((a) => a.name === 'RequestMapping')
    cls.prefix = mapping ? mappingPaths(mapping.args)[0] : ''
    cls.controller = annotations.some((a) => a.name === 'RestController' || a.name === 'Controller') || !!mapping
    cls.springApp = annotations.some((a) => a.name === 'SpringBootApplication')
    classes.push(cls)
    out.exports.push({ name: cls.name, local: cls.name })
  }
  const classAt = (idx) => {
    let best = null
    for (const c of classes) if (c.open < idx && idx < c.close && (!best || c.open > best.open)) best = c
    return best
  }

  // ---------- fields ----------
  const fieldRe = /([A-Z][\w.]*(?:\s*<[^;=(){}]*>)?(?:\[\])?)\s+([a-z_$][\w$]*)\s*(=[^;]*)?;/g
  let fm
  while ((fm = fieldRe.exec(structural))) {
    const c = classAt(fm.index)
    if (!c || depthAt[fm.index] !== c.depth + 1) continue
    c.fields[fm[2]] = baseType(fm[1])
    const fullType = fm[1]
    if (/\bstatic\b/.test(segBefore(fm.index).text + structural.slice(segBefore(fm.index).start, fm.index)) && fm[3]) {
      const lit = noComments.slice(fm.index, fm.index + fm[0].length).match(/=\s*"((?:[^"\\]|\\.)*)"\s*;/)
      if (lit) out.consts[fm[2]] = lit[1]
    }
    const ann = annotationsIn(segBefore(fm.index).text)
    const val = ann.find((a) => a.name === 'Value')
    if (val) for (const s of strings(val.args || '')) for (const p of s.matchAll(/\$\{([\w.-]+)/g)) out.env.push({ name: p[1], line: lineAt(fm.index), property: true })
    void fullType
  }

  // ---------- methods ----------
  const methodRe = /((?:(?:public|protected|private|static|final|synchronized|abstract|native|default|transient)\s+)*)(?:<[^>{;()]*>\s+)?([\w$.]+(?:\s*<[^{;()]*>)?(?:\[\])*)\s+([a-zA-Z_$][\w$]*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:throws\s+[\w.,\s]+)?\{/g
  const ctorRe = /(?:(?:public|protected|private)\s+)?([A-Z][\w$]*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:throws\s+[\w.,\s]+)?\{/g
  const methods = []
  const addMethod = (m, name, ret, paramsRaw, isCtor) => {
    const open = m.index + m[0].length - 1
    const c = classAt(open)
    if (!c || depthAt[open] !== c.depth + 1) return
    if (isCtor && name !== c.name) return
    if (!isCtor && (KEYWORDS.has(name) || KEYWORDS.has(ret) || ret === 'else')) return
    const close = matchBrace(structural, open)
    const pre = segBefore(m.index)
    const startIdx = pre.start + (pre.text.length - pre.text.trimStart().length)
    const anns = annotationsIn(pre.text)
    const params = splitParams(noComments.slice(m.index, open).match(/\(([\s\S]*)\)/)?.[1] ?? paramsRaw)
    const qual = `${c.name}.${name}`
    const mods = m[1] || ''
    const fn = {
      name, qual, kind: isCtor ? 'constructor' : name === 'main' && /static/.test(m[0]) ? 'main' : 'method', className: c.name,
      line: lineAt(startIdx), defLine: lineAt(m.index + m[0].indexOf(name)), endLine: lineAt(close), params, returns: isCtor ? null : ret.trim(),
      annotations: anns.map((a) => a.name), doc: javadoc(startIdx), exported: /\bpublic\b/.test(mods) || c.kind === 'interface' ? `${c.name}#` : undefined,
      static: /\bstatic\b/.test(mods), bodyStart: open, bodyEnd: close,
    }
    if (isCtor) for (const p of params) if (p.type) c.fields[p.name] = c.fields[p.name] || baseType(p.type)
    methods.push({ fn, anns, cls: c })
  }
  let mm
  while ((mm = methodRe.exec(structural))) addMethod(mm, mm[3], mm[2], mm[4], false)
  while ((mm = ctorRe.exec(structural))) addMethod(mm, mm[1], '', mm[2], true)
  methods.sort((a, b) => a.fn.bodyStart - b.fn.bodyStart)
  const seen = new Set()

  for (const { fn, anns, cls } of methods) {
    if (seen.has(fn.bodyStart)) continue
    seen.add(fn.bodyStart)
    out.functions.push(fn)
    // routes
    if (cls.controller) {
      for (const a of anns) {
        const verb = MAPPINGS[a.name]
        if (!verb) continue
        let method = verb
        if (a.name === 'RequestMapping') {
          const rm = (a.args || '').match(/RequestMethod\.(\w+)/)
          method = rm ? rm[1] : 'ANY'
        }
        for (const p of mappingPaths(a.args)) out.routes.push({ method, path: joinPath(cls.prefix, p), line: fn.line, recv: cls.name, framework: 'spring', handler: { fn: fn.qual } })
      }
    }
    if (anns.some((a) => a.name === 'Scheduled')) {
      const a = anns.find((x) => x.name === 'Scheduled')
      out.ops.push({ fn: fn.qual, cat: 'jobs', verb: 'schedule', line: fn.line, lib: 'Spring', target: a.args || '', label: `Runs on a schedule (@Scheduled${a.args ? ' ' + shortSel(a.args, 40) : ''})`, resource: null })
    }
    for (const a of anns.filter((x) => /^(KafkaListener|RabbitListener|JmsListener|SqsListener|EventListener)$/.test(x.name))) {
      out.ops.push({ fn: fn.qual, cat: 'realtime', verb: 'listen', line: fn.line, lib: a.name, target: strings(a.args || '')[0] || a.name, label: `Consumes messages (@${a.name})`, resource: { kind: 'realtime', key: `realtime:${a.name.replace('Listener', '').toLowerCase()}`, label: a.name.replace('Listener', '') } })
    }

    // ---- body analysis ----
    const body = structural.slice(fn.bodyStart, fn.bodyEnd)
    const bodyNC = noComments.slice(fn.bodyStart, fn.bodyEnd)
    const types = { ...cls.fields }
    for (const p of fn.params) if (p.type) types[p.name] = baseType(p.type)
    for (const lm of body.matchAll(/\b([A-Z][\w]*(?:<[^;=(){}]*>)?(?:\[\])?)\s+([a-z_$][\w$]*)\s*[=:;]/g)) types[lm[2]] = baseType(lm[1])
    for (const lm of body.matchAll(/\bvar\s+([a-z_$][\w$]*)\s*=\s*new\s+([A-Z]\w*)/g)) types[lm[1]] = lm[2]

    const argLiteral = (parenIdx) => {
      const seg = bodyNC.slice(parenIdx, parenIdx + 400)
      const m = seg.match(/^\(\s*(?:[\w.]+\s*,\s*)?"((?:[^"\\]|\\.)*)"(\s*\+)?/)
      if (!m) return null
      return m[1] + (m[2] ? '${…}' : '')
    }
    const firstLiteral = (parenIdx) => {
      const seg = bodyNC.slice(parenIdx, parenIdx + 400)
      const m = seg.match(/"((?:[^"\\]|\\.)*)"/)
      return m ? m[1] : null
    }
    const statementAround = (idx) => {
      let s = idx
      while (s > 0 && !';{}'.includes(body[s - 1])) s--
      let e = idx
      while (e < body.length && body[e] !== ';') e++
      return bodyNC.slice(s, e)
    }

    for (const m of body.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/g)) {
      const recv = m[1]
      const name = m[2]
      if (KEYWORDS.has(recv) && recv !== 'this' && recv !== 'super') continue
      const parenIdx = m.index + m[0].length - 1
      const line = lineAt(fn.bodyStart + m.index)
      let recvType = /^[A-Z]/.test(recv) ? recv : types[recv] || null
      if (recv === 'this') recvType = cls.name
      out.calls.push({ fn: fn.qual, name, recv, recvType, text: `${recv}.${name}`, line })

      const T = recvType || ''
      const op = (o) => out.ops.push({ fn: fn.qual, line, ...o })
      // repositories (resolved fully in the analyzer once all files are known)
      if (/Repo(sitory)?$/.test(T) && !/^(Spring|Jpa)/.test(T)) {
        const write = /^(save|delete|insert|update|remove|persist|flush|create)/.test(name)
        op({ cat: 'db', verb: name, lib: 'Spring Data', target: T.replace(/Repo(sitory)?$/, ''), label: `${write ? 'Writes' : 'Reads'} ${T.replace(/Repo(sitory)?$/, '')} (${recv}.${name})`, rw: write ? 'write' : 'read', resource: dbResource(T.replace(/Repo(sitory)?$/, ''), 'JPA'), repoType: T })
        continue
      }
      if (T === 'RestTemplate' || T === 'TestRestTemplate') {
        const method = /^get/.test(name) ? 'GET' : /^post/.test(name) ? 'POST' : name === 'put' ? 'PUT' : name === 'delete' ? 'DELETE' : name === 'patchForObject' ? 'PATCH' : (statementAround(m.index).match(/HttpMethod\.(\w+)/)?.[1] || 'GET')
        addJavaHttp(out, fn.qual, line, method, argLiteral(parenIdx), 'RestTemplate')
        continue
      }
      if (name === 'uri' && /webClient|WebClient|client/i.test(statementAround(m.index))) {
        const st = statementAround(m.index)
        const method = st.match(/\.(get|post|put|delete|patch)\s*\(\s*\)/)?.[1]?.toUpperCase() || 'GET'
        addJavaHttp(out, fn.qual, line, method, argLiteral(parenIdx), 'WebClient')
        continue
      }
      if (recv === 'URI' && name === 'create') {
        const st = statementAround(m.index)
        if (/HttpRequest|newBuilder|uri\s*\(/.test(st)) addJavaHttp(out, fn.qual, line, st.match(/\.(GET|POST|PUT|DELETE)\s*\(/)?.[1] || 'GET', argLiteral(parenIdx), 'HttpClient')
        continue
      }
      if (/^(JdbcTemplate|NamedParameterJdbcTemplate|JdbcClient)$/.test(T) || (T === 'EntityManager' && /^create(Native)?Query$/.test(name)) || (T === 'Statement' || T === 'PreparedStatement' || T === 'Connection') && /^(execute\w*|prepareStatement)$/.test(name)) {
        const s = firstLiteral(parenIdx)
        const info = sqlInfo(s)
        for (const tb of info?.tables?.length ? info.tables : [null]) op({ cat: 'db', verb: info?.verb || name, lib: T, target: tb || (s ? shortSel(s) : 'SQL'), label: info ? `${info.verb} ${tb ?? ''}`.trim() + ' (SQL)' : `${T}.${name}()`, rw: info ? sqlVerbKind(info.verb) : /update|execute/.test(name) ? 'write' : 'read', sql: s, resource: dbResource(tb, 'SQL') })
        continue
      }
      if (T === 'EntityManager' && /^(persist|merge|remove|find|getReference)$/.test(name)) {
        op({ cat: 'db', verb: name, lib: 'JPA', target: 'entity', label: `EntityManager.${name}()`, rw: name === 'find' || name === 'getReference' ? 'read' : 'write', resource: dbResource(null, 'JPA') })
        continue
      }
      if (/MailSender$/.test(T) && /^send/.test(name)) {
        op({ cat: 'email', verb: 'send', lib: T, target: 'email', label: 'Sends an email', resource: { kind: 'email', key: 'email', label: 'Email' } })
        continue
      }
      if (/^(SimpMessagingTemplate|SimpMessageSendingOperations)$/.test(T) && /^convertAndSend/.test(name)) {
        const topic = argLiteral(parenIdx)
        op({ cat: 'realtime', verb: 'publish', lib: 'STOMP', target: topic || 'topic', label: `Pushes to WebSocket ${topic ? '`' + topic + '`' : 'topic'}`, resource: { kind: 'realtime', key: 'realtime:websocket', label: 'WebSocket (STOMP)' } })
        continue
      }
      if (/^(KafkaTemplate|RabbitTemplate|JmsTemplate)$/.test(T) && /^(send|convertAndSend)$/.test(name)) {
        op({ cat: 'realtime', verb: 'publish', lib: T, target: argLiteral(parenIdx) || T, label: `Publishes message via ${T}`, resource: { kind: 'realtime', key: `realtime:${T.replace('Template', '').toLowerCase()}`, label: T.replace('Template', '') } })
        continue
      }
      if (/PasswordEncoder$/.test(T) && /^(encode|matches)$/.test(name) || (recv === 'Jwts' && /^(builder|parser|parserBuilder)$/.test(name)) || (/^Jwt/.test(T) && /^(generate|validate|extract|parse)/.test(name))) {
        op({ cat: 'auth', verb: name, lib: T || recv, target: name, label: `Auth: ${recv}.${name}()`, resource: null })
        continue
      }
      if (recv === 'Jsoup' && /^(connect|parse)$/.test(name)) {
        const u = argLiteral(parenIdx)
        const p = parseUrl(u)
        op(name === 'connect'
          ? { cat: 'scrape', verb: 'load', lib: 'Jsoup', target: u || '(dynamic URL)', label: `Fetches ${shortSel(u || '(dynamic URL)', 60)} with Jsoup`, resource: p.kind === 'external' ? hostResource(p.host, 'web') : { kind: 'web', key: 'web:pages', label: 'web pages' } }
          : { cat: 'scrape', verb: 'parse', lib: 'Jsoup', target: 'HTML', label: 'Parses HTML with Jsoup', resource: null })
        continue
      }
      if ((T === 'Document' || T === 'Element' || T === 'Elements') && importsPkg('org.jsoup') && /^(select|selectFirst|getElementsByClass|getElementById|getElementsByTag)$/.test(name)) {
        const s = argLiteral(parenIdx)
        op({ cat: 'scrape', verb: 'select', lib: 'Jsoup', target: s || name, label: s ? `Extracts \`${shortSel(s)}\`` : `${recv}.${name}()`, resource: null })
        continue
      }
      if (recv === 'Files' && /^(read\w*|lines|newBufferedReader|newInputStream|write\w*|newBufferedWriter|newOutputStream|copy|move|delete\w*|createDirector\w*)$/.test(name)) {
        const write = /^(write|newBufferedWriter|newOutputStream|copy|move|delete|create)/.test(name)
        const p = firstLiteral(parenIdx)
        op({ cat: 'file', verb: write ? 'write' : 'read', lib: 'java.nio', target: p || '(dynamic path)', label: `${write ? 'Writes' : 'Reads'} ${p ? shortSel(p, 50) : 'a file'}`, rw: write ? 'write' : 'read', resource: fileResource(p) })
        continue
      }
      if (recv === 'System' && name === 'getenv') {
        const v = argLiteral(parenIdx)
        if (v) out.env.push({ name: v, line })
        continue
      }
      if (importsPkg('com.stripe') && /^(Session|PaymentIntent|Charge|Customer|Subscription|Refund|Price|Product)$/.test(recv) && /^(create|retrieve|update|list)$/.test(name)) {
        op({ cat: 'payments', verb: name, lib: 'Stripe', target: `${recv}.${name}`, label: `Stripe ${recv}.${name}()`, resource: { kind: 'payments', key: 'payments:stripe', label: 'Stripe' } })
        continue
      }
    }
    // same-class bare calls
    for (const m of body.matchAll(/(?<![.\w$])([a-z_$][\w$]*)\s*\(/g)) {
      if (KEYWORDS.has(m[1])) continue
      const before = body.slice(Math.max(0, m.index - 4), m.index)
      if (/new\s*$/.test(before)) continue
      out.calls.push({ fn: fn.qual, name: m[1], recv: null, recvType: cls.name, text: m[1], line: lineAt(fn.bodyStart + m.index) })
    }
    // file streams
    for (const m of bodyNC.matchAll(/new\s+(FileReader|FileWriter|FileInputStream|FileOutputStream|PrintWriter|File)\s*\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const write = /Writer|Output|Print/.test(m[1])
      out.ops.push({ fn: fn.qual, line: lineAt(fn.bodyStart + m.index), cat: 'file', verb: write ? 'write' : 'read', lib: m[1], target: m[2], label: `${write ? 'Writes' : 'Reads'} ${shortSel(m[2], 50)}`, rw: write ? 'write' : 'read', resource: fileResource(m[2]) })
    }
  }

  for (const c of classes) {
    out.classes.push({
      name: c.name, kind: c.kind, line: c.line, endLine: c.endLine, extends: c.extends, implements: c.implements,
      annotations: c.annotations, repositoryOf: c.repositoryOf, controller: c.controller, springApp: c.springApp,
      prefix: c.prefix, doc: c.doc, fields: c.fields,
    })
    if (c.kind === 'interface' && c.repositoryOf) {
      out.functions.push({ name: c.name, qual: c.name, kind: 'repository', className: c.name, line: c.line, endLine: c.endLine, params: [], doc: c.doc || `Spring Data repository for ${c.repositoryOf}`, exported: `${c.name}#` })
    }
  }
  for (const f of out.functions) { delete f.bodyStart; delete f.bodyEnd }
  void imported
  return out
}

function splitParams(raw) {
  if (!raw || !raw.trim()) return []
  const parts = []
  let depth = 0, cur = ''
  for (const ch of raw) {
    if (ch === '<' || ch === '(') depth++
    if (ch === '>' || ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => {
    const anns = [...p.matchAll(/@(\w+)/g)].map((m) => m[1])
    const clean = p.replace(/@\w+(\s*\([^)]*\))?/g, '').replace(/\bfinal\b/g, '').trim()
    const m = clean.match(/^([\s\S]+?)\s+([\w$]+)$/)
    return m ? { name: m[2], type: m[1].trim(), annotations: anns } : { name: clean }
  })
}

function addJavaHttp(out, fn, line, method, url, lib) {
  const parsed = parseUrl(url)
  out.http.push({ fn, line, method, url, lib, parsed })
  out.ops.push({ fn, line, cat: 'http', verb: method, lib, target: url || '(dynamic URL)', label: `${method} ${shortSel(url || '(dynamic URL)', 64)}`, resource: parsed.kind === 'external' ? hostResource(parsed.host) : null, httpIndex: out.http.length - 1 })
}
