// Python analysis: runs py_extract.py once over every file, then classifies the raw
// facts into the same shape the JS extractor produces.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUrl, hostResource, sqlInfo, sqlVerbKind, fileResource, dbResource, shortSel } from './ops.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'py_extract.py')

let cachedPython
/** Newest Python 3 on this machine (for parsing; projects may use newer syntax). */
export function findPython() {
  if (cachedPython !== undefined) return cachedPython
  const cands = [process.env.UNDERSTAND_PYTHON, 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', '/opt/homebrew/bin/python3', 'python3', 'python'].filter(Boolean)
  for (const c of cands) {
    const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0], sys.version_info[1])'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.startsWith('3 ')) {
      cachedPython = c
      return c
    }
  }
  cachedPython = null
  return null
}

export function runPyExtract(items) {
  const py = findPython()
  if (!py || !items.length) return Promise.resolve({})
  return new Promise((resolve) => {
    const child = spawn(py, ['-I', SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    let err = ''
    child.stdout.on('data', (c) => chunks.push(c))
    child.stderr.on('data', (c) => (err += c))
    child.on('close', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        console.error('[understand] python extractor failed:', err.slice(0, 500))
        resolve({})
      }
    })
    child.stdin.end(JSON.stringify(items))
  })
}

const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'request', 'options'])
const SOUP_METHODS = new Set(['find', 'find_all', 'findAll', 'findChildren', 'select', 'select_one', 'xpath', 'css', 'cssselect', 'find_next', 'find_parent'])
const PAGE_METHODS = new Set(['goto', 'locator', 'query_selector', 'query_selector_all', 'inner_text', 'text_content', 'inner_html', 'eval_on_selector', 'eval_on_selector_all', 'wait_for_selector', 'click', 'fill', 'get_by_text', 'get_by_role', 'content'])
const TRANSFORMS = new Set(['groupby', 'merge', 'join', 'pivot', 'pivot_table', 'concat', 'agg', 'aggregate', 'dropna', 'fillna', 'drop_duplicates', 'melt', 'explode', 'resample', 'rolling', 'sort_values', 'value_counts', 'apply', 'astype', 'query', 'to_datetime', 'to_numeric', 'crosstab', 'cut', 'qcut', 'get_dummies', 'interpolate', 'with_columns', 'group_by', 'filter'])
const PD_READ = /^(read_csv|read_excel|read_json|read_parquet|read_table|read_pickle|read_feather|read_fwf|read_xml|read_orc)$/
const PD_WRITE = /^(to_csv|to_excel|to_json|to_parquet|to_pickle|to_feather|to_xml|to_html|to_markdown)$/
const MONGO_VERBS = new Set(['find', 'find_one', 'insert_one', 'insert_many', 'update_one', 'update_many', 'delete_one', 'delete_many', 'aggregate', 'count_documents', 'replace_one', 'find_one_and_update', 'bulk_write'])
const DJANGO_VERBS = /^(filter|get|create|all|update|delete|bulk_create|bulk_update|exclude|values|values_list|annotate|aggregate|count|first|last|get_or_create|update_or_create|order_by|select_related|prefetch_related|exists|raw)$/
const LLM_MODULES = { openai: 'OpenAI', anthropic: 'Anthropic', 'google.generativeai': 'Gemini', 'google.genai': 'Gemini', langchain: 'LangChain', langchain_openai: 'LangChain', langchain_anthropic: 'LangChain', langchain_community: 'LangChain', ollama: 'Ollama', groq: 'Groq', mistralai: 'Mistral', cohere: 'Cohere', transformers: 'Hugging Face', litellm: 'LiteLLM', together: 'Together' }
const DB_MODULES = { sqlite3: 'SQLite', psycopg2: 'PostgreSQL', psycopg: 'PostgreSQL', asyncpg: 'PostgreSQL', pymysql: 'MySQL', mysql: 'MySQL', sqlalchemy: 'SQLAlchemy', flask_sqlalchemy: 'SQLAlchemy', sqlmodel: 'SQLModel', pymongo: 'MongoDB', motor: 'MongoDB', redis: 'Redis', supabase: 'Supabase', firebase_admin: 'Firestore', duckdb: 'DuckDB', peewee: 'Peewee', tortoise: 'Tortoise', django: 'Django ORM' }

function sel(info) {
  if (!info) return null
  return info.s ?? null
}

/** String value, or ${name} when the argument is a plain variable (so wrappers can be traced). */
function urlArg(info) {
  if (!info) return null
  if (info.s != null) return info.s
  return /^[A-Za-z_]\w*$/.test(info.t || '') && !/^(None|True|False)$/.test(info.t) ? '${' + info.t + '}' : null
}

export function classifyPython(facts, file) {
  const out = {
    imports: [], exports: [], functions: [], calls: [], http: [], routes: [], mounts: [], ops: [],
    consts: facts.consts || {}, env: facts.env || [], ports: [], errors: facts.error ? [facts.error] : [], pkgs: [],
    routerPrefixes: {}, classes: facts.classes || [], fields: facts.fields || {},
  }
  // ---- imports & aliases ----
  const modules = new Set()
  const fullModules = new Set()
  const alias = new Map()
  for (const imp of facts.imports || []) {
    out.imports.push({ ...imp, source: (imp.level ? '.'.repeat(imp.level) : '') + imp.module })
    if (!imp.level) {
      modules.add(imp.module.split('.')[0])
      fullModules.add(imp.module)
    }
    if (!imp.names) {
      const local = imp.alias || imp.module.split('.')[0]
      alias.set(local, imp.alias ? imp.module : imp.module.split('.')[0])
    } else {
      for (const nm of imp.names) {
        if (nm.name === '*') continue
        alias.set(nm.alias || nm.name, imp.level ? `.${nm.name}` : `${imp.module}.${nm.name}`)
      }
    }
  }
  out.pkgs = [...modules]
  const canon = (t) => {
    const i = t.indexOf('.')
    const head = (i < 0 ? t : t.slice(0, i)).replace(/\(\)$/, '')
    const rest = i < 0 ? (t.endsWith('()') ? '()' : '') : t.slice(i)
    const a = alias.get(head)
    return a && !a.startsWith('.') ? a + rest : t
  }
  const llmProvider = Object.entries(LLM_MODULES).find(([m]) => [...fullModules].some((x) => x === m || x.startsWith(m + '.')))?.[1]
  const dbEngine = Object.entries(DB_MODULES).find(([m]) => modules.has(m))?.[1]
  const hasPandas = modules.has('pandas') || modules.has('polars') || modules.has('numpy')

  // ---- functions ----
  const fnClass = new Map()
  for (const f of facts.functions || []) {
    const exported = f.kind === 'function' && !f.name.startsWith('_') ? f.name : f.kind === 'method' && !f.name.startsWith('_') ? `${f.className}#` : undefined
    out.functions.push({ ...f, exported })
    if (f.className) fnClass.set(f.qual, f.className)
  }
  for (const c of facts.classes || []) out.exports.push({ name: c.name, local: c.name })
  for (const f of out.functions) if (f.exported && f.kind === 'function') out.exports.push({ name: f.name, local: f.qual })
  for (const k of Object.keys(out.consts)) out.exports.push({ name: k, local: k, const: true })

  // ---- receiver kinds from assignments ----
  const kinds = new Map()
  const kindOf = (c) => {
    if (/^(requests\.(Session|session)|httpx\.(Client|AsyncClient)|aiohttp\.ClientSession|urllib3\.PoolManager|requests_html\.(HTMLSession|AsyncHTMLSession)|cloudscraper\.create_scraper|curl_cffi\.requests\.Session)$/.test(c)) return 'http'
    if (/^(bs4\.BeautifulSoup|BeautifulSoup|lxml\.html\.fromstring|lxml\.etree\.HTML|lxml\.html\.document_fromstring|parsel\.Selector|selectolax\.parser\.HTMLParser)$/.test(c)) return 'soup'
    if (/webdriver\.(Chrome|Firefox|Edge|Safari|Remote)$|undetected_chromedriver\.Chrome$|seleniumbase/.test(c)) return 'driver'
    if (/\.new_page$/.test(c)) return 'page'
    if (/\.(chromium|firefox|webkit)\.launch$|\.new_context$/.test(c)) return 'browser'
    if (/^(sqlite3\.connect|psycopg2\.connect|psycopg\.connect|asyncpg\.connect|asyncpg\.create_pool|pymysql\.connect|mysql\.connector\.connect|duckdb\.connect|sqlalchemy\.create_engine|sqlmodel\.create_engine)$/.test(c)) return 'sql'
    if (/(sessionmaker|SessionLocal|scoped_session|sqlalchemy\.orm\.Session|sqlmodel\.Session)(\(\))?$/.test(c)) return 'sql'
    if (/^(pymongo\.MongoClient|motor\.motor_asyncio\.AsyncIOMotorClient)$/.test(c)) return 'mongo'
    if (/^redis\.(Redis|StrictRedis|from_url)$|^redis\.asyncio/.test(c)) return 'redis'
    if (/^(openai\.(OpenAI|AsyncOpenAI|AzureOpenAI)|anthropic\.(Anthropic|AsyncAnthropic)|google\.generativeai\.GenerativeModel|google\.genai\.Client|ollama\.Client|groq\.Groq|cohere\.Client|transformers\.pipeline)$/.test(c) || /^langchain\w*\.\w*Chat\w+$/.test(c)) return 'llm'
    if (/^supabase\.create_client$/.test(c)) return 'supabase'
    if (/^smtplib\.SMTP(_SSL)?$/.test(c)) return 'smtp'
    if (/^pandas\.(read_\w+|DataFrame|concat|merge)$|^polars\./.test(c)) return 'df'
    if (/^(flask\.Blueprint|fastapi\.APIRouter)$/.test(c)) return 'router'
    if (/^(flask\.Flask|fastapi\.FastAPI)$/.test(c)) return 'app'
    return null
  }
  const keyFor = (fn, target) => {
    if (target.startsWith('self.')) return `${fnClass.get(fn) || ''}|${target}`
    return `${fn}|${target}`
  }
  const lookupKind = (fn, recvPath) => kinds.get(keyFor(fn, recvPath)) ?? kinds.get(`<module>|${recvPath}`) ?? null
  for (const a of facts.assigns || []) {
    const c = canon(a.call)
    let k = kindOf(c)
    if (!k) {
      const segs = a.call.split('.')
      const parentKind = segs.length > 1 ? lookupKind(a.fn, segs.slice(0, -1).join('.')) : null
      if (parentKind && /(cursor|connect|begin|Session|session)$/.test(segs[segs.length - 1])) k = 'sql'
      else if (parentKind === 'browser' && /new_page/.test(a.call)) k = 'page'
      else if (parentKind === 'soup' || parentKind === 'df') k = parentKind
    }
    for (const t of a.targets) {
      if (k) kinds.set(keyFor(a.fn, t), k)
      if (k === 'router' || k === 'app') {
        const p = sel(a.kw?.url_prefix) ?? sel(a.kw?.prefix)
        out.routerPrefixes[t] = p || ''
      }
    }
  }

  // ---- helpers ----
  const addOp = (fn, op) => out.ops.push({ fn, ...op })
  const addHttp = (c, method, url, lib, methodParam) => {
    const parsed = parseUrl(url)
    out.http.push({ fn: c.fn, line: c.line, method: method.toUpperCase(), url: url ?? null, lib, parsed, methodParam: methodParam || undefined })
    addOp(c.fn, { cat: 'http', verb: method.toUpperCase(), line: c.line, lib, target: url ?? '(dynamic URL)', label: `${method.toUpperCase()} ${shortSel(url ?? '(dynamic URL)', 64)}`, resource: parsed.kind === 'external' ? hostResource(parsed.host) : null, httpIndex: out.http.length - 1 })
  }
  const soupSelector = (c) => {
    const a0 = sel(c.args?.[0])
    const cls = sel(c.kw?.class_) ?? c.kw?.attrs?.d?.class
    const id = sel(c.kw?.id)
    let s = a0 || ''
    if (cls) s += '.' + String(cls).split(/\s+/).join('.')
    if (id) s += '#' + id
    return s || null
  }

  // ---- calls ----
  for (const c of facts.calls || []) {
    const t = c.text
    const segs = t.split('.')
    const name = segs[segs.length - 1].replace(/\(\)$/, '')
    const recvPath = segs.slice(0, -1).join('.')
    const recv = segs.length > 1 ? segs[0].replace(/\(\)$/, '') : null
    const cc = canon(t)
    const rk = recvPath ? lookupKind(c.fn, recvPath) : null
    const line = c.line
    const argv = (c.args || []).map(urlArg)
    out.calls.push({ fn: c.fn, name, recv, text: t, line, args: argv.some((v) => v != null) ? argv : undefined, argText: c.args?.length ? c.args.map((a) => a.t) : undefined })

    // HTTP
    if (/^(requests|httpx)\.(get|post|put|patch|delete|head|request|options)$/.test(cc) || (rk === 'http' && HTTP_VERBS.has(name))) {
      const isReq = name === 'request'
      const method = isReq ? sel(c.args?.[0]) || sel(c.kw?.method) || 'GET' : name
      const url = isReq ? urlArg(c.args?.[1]) ?? urlArg(c.kw?.url) : urlArg(c.args?.[0]) ?? urlArg(c.kw?.url)
      const methodParam = isReq && !sel(c.args?.[0]) && /^[A-Za-z_]\w*$/.test(c.args?.[0]?.t || '') ? c.args[0].t : null
      addHttp(c, method, url, recvPath && rk === 'http' ? 'session' : segs[0], methodParam)
      continue
    }
    if (/^(urllib\.request\.Request|urllib2\.Request)$/.test(cc)) {
      addHttp(c, sel(c.kw?.method) || (c.kw?.data || c.nargs > 1 ? 'POST' : 'GET'), urlArg(c.args?.[0]) ?? urlArg(c.kw?.url), 'urllib', !sel(c.kw?.method) && /^[A-Za-z_]\w*$/.test(c.kw?.method?.t || '') ? c.kw.method.t : null)
      continue
    }
    if (/^(urllib\.request\.urlopen|urllib2\.urlopen)$/.test(cc)) {
      // urlopen(req) with a Request object is already recorded at the Request(...) call
      const u = sel(c.args?.[0]) ?? c.args?.[0]?.inner
      if (u != null) addHttp(c, c.kw?.data || c.nargs > 1 ? 'POST' : 'GET', u, 'urllib')
      continue
    }
    if (/^(scrapy\.Request|scrapy\.FormRequest)$/.test(cc) || (recv === 'response' && name === 'follow' && modules.has('scrapy'))) {
      const u = sel(c.args?.[0]) ?? sel(c.kw?.url)
      const p = parseUrl(u)
      addOp(c.fn, { cat: 'scrape', verb: 'load', line, lib: 'scrapy', target: u || '(dynamic URL)', label: `Crawls ${shortSel(u || '(dynamic URL)', 60)}`, resource: p.kind === 'external' ? hostResource(p.host, 'web') : { kind: 'web', key: 'web:pages', label: 'web pages' } })
      continue
    }

    // Scraping
    if (/^(bs4\.BeautifulSoup|BeautifulSoup)$/.test(cc)) {
      addOp(c.fn, { cat: 'scrape', verb: 'parse', line, lib: 'BeautifulSoup', target: 'HTML', label: 'Parses HTML with BeautifulSoup', resource: null })
      continue
    }
    if (/^(lxml\.html\.fromstring|lxml\.etree\.HTML|parsel\.Selector|selectolax\.parser\.HTMLParser)$/.test(cc)) {
      addOp(c.fn, { cat: 'scrape', verb: 'parse', line, lib: segs[0], target: 'HTML', label: `Parses HTML with ${cc.split('.')[0]}`, resource: null })
      continue
    }
    if (SOUP_METHODS.has(name) && (rk === 'soup' || (modules.has('bs4') && recv && name !== 'filter' && !/^(re|self|os|json|str|list)$/.test(recv)) || (modules.has('scrapy') && recv === 'response' && (name === 'css' || name === 'xpath')) || (modules.has('lxml') && name === 'xpath'))) {
      const s = soupSelector(c)
      addOp(c.fn, { cat: 'scrape', verb: 'select', line, lib: modules.has('bs4') ? 'BeautifulSoup' : segs[0], target: s || name, label: s ? `Extracts \`${shortSel(s)}\`` : `${recvPath}.${name}()`, resource: null })
      continue
    }
    if (rk === 'driver' || (modules.has('selenium') && /^(driver|browser|wd)$/.test(recv || ''))) {
      if (name === 'get') {
        const u = sel(c.args?.[0])
        const p = parseUrl(u)
        addOp(c.fn, { cat: 'scrape', verb: 'load', line, lib: 'Selenium', target: u || '(dynamic URL)', label: `Opens ${shortSel(u || '(dynamic URL)', 60)} in Selenium`, resource: p.kind === 'external' ? hostResource(p.host, 'web') : { kind: 'web', key: 'web:pages', label: 'web pages' } })
        continue
      }
      if (/^find_elements?(_by_\w+)?$/.test(name)) {
        const s = sel(c.args?.[1]) ?? sel(c.args?.[0])
        addOp(c.fn, { cat: 'scrape', verb: 'select', line, lib: 'Selenium', target: s || name, label: s ? `Extracts \`${shortSel(s)}\`` : `driver.${name}()`, resource: null })
        continue
      }
    }
    if ((rk === 'page' || (recv === 'page' && (modules.has('playwright') || modules.has('pyppeteer')))) && PAGE_METHODS.has(name)) {
      const a = sel(c.args?.[0])
      if (name === 'goto') {
        const p = parseUrl(a)
        addOp(c.fn, { cat: 'scrape', verb: 'load', line, lib: 'Playwright', target: a || '(dynamic URL)', label: `Opens ${shortSel(a || '(dynamic URL)', 60)} in a headless browser`, resource: p.kind === 'external' ? hostResource(p.host, 'web') : { kind: 'web', key: 'web:pages', label: 'web pages' } })
      } else addOp(c.fn, { cat: 'scrape', verb: 'select', line, lib: 'Playwright', target: a || name, label: a ? `Extracts \`${shortSel(a)}\`` : `page.${name}()`, resource: null })
      continue
    }
    if (cc === 'pandas.read_html') {
      const u = sel(c.args?.[0])
      const p = parseUrl(u)
      addOp(c.fn, { cat: 'scrape', verb: 'load', line, lib: 'pandas', target: u || 'HTML', label: `Reads HTML tables${u ? ' from ' + shortSel(u, 50) : ''}`, resource: p.kind === 'external' ? hostResource(p.host, 'web') : null })
      continue
    }

    // Databases
    if (/^(sqlite3\.connect|duckdb\.connect)$/.test(cc)) {
      const f = sel(c.args?.[0])
      addOp(c.fn, { cat: 'db', verb: 'connect', line, lib: cc.split('.')[0], target: f || 'database', label: `Opens ${cc.startsWith('duck') ? 'DuckDB' : 'SQLite'} database ${f ? shortSel(f, 40) : ''}`.trim(), resource: dbResource(f ? path.posix.basename(f) : null, cc.startsWith('duck') ? 'DuckDB' : 'SQLite') })
      continue
    }
    if ((rk === 'sql' || (dbEngine && /^(cursor|cur|conn|connection|db|session|engine|con)$/.test(recv || '') && recvPath.split('.').length === 1) || /^(db\.session|self\.(db|conn|cursor|session))$/.test(recvPath)) && /^(execute|executemany|executescript|query|scalars|scalar|fetch|fetchrow|fetchval|add|add_all|delete|merge|exec)$/.test(name)) {
      if (name === 'query') {
        const model = c.args?.[0]?.t
        if (model && /^[A-Z]/.test(model)) {
          addOp(c.fn, { cat: 'db', verb: 'query', line, lib: dbEngine || 'SQL', target: model, label: `Reads ${model} (session.query)`, rw: 'read', resource: dbResource(model, dbEngine) })
          continue
        }
      }
      if (/^(add|add_all|delete|merge)$/.test(name)) {
        addOp(c.fn, { cat: 'db', verb: name, line, lib: dbEngine || 'SQLAlchemy', target: c.args?.[0]?.t || 'row', label: `${name === 'delete' ? 'Deletes' : 'Saves'} ${c.args?.[0]?.t || 'a row'} (session.${name})`, rw: 'write', resource: dbResource(null, dbEngine) })
        continue
      }
      const s = sel(c.args?.[0]) ?? c.args?.[0]?.inner
      const info = sqlInfo(s)
      for (const tb of info?.tables?.length ? info.tables : [null]) {
        addOp(c.fn, { cat: 'db', verb: info?.verb || name, line, lib: dbEngine || 'SQL', target: tb || (s ? shortSel(s) : 'SQL'), label: info ? `${info.verb} ${tb ?? ''}`.trim() + ' (SQL)' : `Runs SQL via ${recvPath}.${name}()`, rw: info ? sqlVerbKind(info.verb) : 'read', sql: s ? s.slice(0, 400) : null, resource: dbResource(tb, dbEngine) })
      }
      continue
    }
    let m = t.match(/^([A-Z]\w*)\.objects\.(\w+)$/)
    if (m && DJANGO_VERBS.test(m[2])) {
      const write = /^(create|update|delete|bulk_|get_or_create|update_or_create)/.test(m[2])
      addOp(c.fn, { cat: 'db', verb: m[2], line, lib: 'Django ORM', target: m[1], label: `${write ? 'Writes' : 'Reads'} ${m[1]} (objects.${m[2]})`, rw: write ? 'write' : 'read', resource: dbResource(m[1], 'Django ORM') })
      continue
    }
    m = t.match(/^([A-Z]\w*)\.query\.(\w+)$/)
    if (m) {
      addOp(c.fn, { cat: 'db', verb: m[2], line, lib: 'SQLAlchemy', target: m[1], label: `Reads ${m[1]} (query.${m[2]})`, rw: 'read', resource: dbResource(m[1], 'SQLAlchemy') })
      continue
    }
    if (MONGO_VERBS.has(name) && (modules.has('pymongo') || modules.has('motor')) && recvPath) {
      const coll = recvPath.match(/\['([^']+)'\]$/)?.[1] ?? recvPath.split('.').pop()
      const write = /^(insert|update|delete|replace|find_one_and|bulk)/.test(name)
      addOp(c.fn, { cat: 'db', verb: name, line, lib: 'MongoDB', target: coll, label: `${write ? 'Writes' : 'Reads'} ${coll} (${name})`, rw: write ? 'write' : 'read', resource: dbResource(coll, 'MongoDB') })
      continue
    }
    if (/^pandas\.(read_sql|read_sql_query|read_sql_table)$/.test(cc) || (name === 'to_sql' && hasPandas)) {
      const s = sel(c.args?.[0])
      const info = sqlInfo(s)
      const tb = name === 'to_sql' ? s : info?.tables?.[0] ?? (name === 'read_sql_table' ? s : null)
      addOp(c.fn, { cat: 'db', verb: name, line, lib: 'pandas', target: tb || 'SQL', label: name === 'to_sql' ? `Writes DataFrame to ${tb || 'a table'}` : `Reads ${tb || 'SQL'} into a DataFrame`, rw: name === 'to_sql' ? 'write' : 'read', sql: info ? s : null, resource: dbResource(tb, dbEngine) })
      continue
    }
    if (rk === 'redis') {
      addOp(c.fn, { cat: 'db', verb: name, line, lib: 'Redis', target: sel(c.args?.[0]) || name, label: `Redis ${name.toUpperCase()}`, resource: dbResource(null, 'Redis') })
      continue
    }
    if ((name === 'table' && (rk === 'supabase' || recv === 'supabase')) || (name === 'collection' && (modules.has('firebase_admin') || fullModules.has('google.cloud.firestore')))) {
      const tb = sel(c.args?.[0])
      addOp(c.fn, { cat: 'db', verb: name, line, lib: name === 'table' ? 'Supabase' : 'Firestore', target: tb || name, label: `${name === 'table' ? 'Table' : 'Collection'} ${tb ?? '(dynamic)'}`, resource: dbResource(tb, name === 'table' ? 'Supabase' : 'Firestore') })
      continue
    }

    // Files
    if (t === 'open' || cc === 'io.open' || cc === 'codecs.open') {
      const p = sel(c.args?.[0])
      const mode = sel(c.args?.[1]) ?? sel(c.kw?.mode) ?? 'r'
      const write = /[wax+]/.test(mode)
      addOp(c.fn, { cat: 'file', verb: write ? 'write' : 'read', line, lib: 'open', target: p || '(dynamic path)', label: `${write ? 'Writes' : 'Reads'} ${p ? shortSel(fileResource(p).label, 60) : 'a file'}`, rw: write ? 'write' : 'read', resource: fileResource(p) })
      continue
    }
    if ((cc.startsWith('pandas.') || cc.startsWith('polars.')) && PD_READ.test(name)) {
      const p = sel(c.args?.[0]) ?? sel(c.kw?.filepath_or_buffer) ?? sel(c.kw?.io) ?? sel(c.kw?.path)
      const u = parseUrl(p)
      if (p && /^https?:/.test(p)) {
        addHttp(c, 'GET', p, 'pandas')
        continue
      }
      addOp(c.fn, { cat: 'file', verb: 'read', line, lib: 'pandas', target: p || '(dynamic path)', label: `Loads ${p ? shortSel(fileResource(p).label, 50) : 'a file'} into a DataFrame`, rw: 'read', resource: u.kind === 'external' ? hostResource(u.host) : fileResource(p) })
      continue
    }
    if (PD_WRITE.test(name) && hasPandas) {
      const p = sel(c.args?.[0]) ?? sel(c.kw?.path_or_buf) ?? sel(c.kw?.path)
      addOp(c.fn, { cat: 'file', verb: 'write', line, lib: 'pandas', target: p || '(dynamic path)', label: `Saves DataFrame to ${p ? shortSel(fileResource(p).label, 50) : 'a file'}`, rw: 'write', resource: fileResource(p) })
      continue
    }
    if (/^(numpy\.(save|savez|savetxt|load|loadtxt|genfromtxt)|joblib\.(dump|load)|torch\.(save|load)|pickle\.(dump|load)|json\.(dump|load)|shutil\.(copy|copy2|copyfile|move|rmtree)|os\.(remove|unlink|rename|makedirs))$/.test(cc)) {
      const write = /(save|dump|copy|move|rmtree|remove|unlink|rename|makedirs)/.test(name)
      if (/^(pickle|json)\./.test(cc)) continue // covered by the surrounding open()
      if (/^(makedirs|rmtree|remove|unlink|rename)$/.test(name)) continue // folder housekeeping, not data
      const p = /^(joblib\.dump|torch\.save|numpy\.save|numpy\.savez|numpy\.savetxt)$/.test(cc) ? sel(c.args?.[1]) ?? sel(c.args?.[0]) : sel(c.args?.[0])
      addOp(c.fn, { cat: 'file', verb: write ? 'write' : 'read', line, lib: cc.split('.')[0], target: p || '(dynamic path)', label: `${write ? 'Writes' : 'Reads'} ${p ? shortSel(fileResource(p).label, 50) : 'a file'} (${cc})`, rw: write ? 'write' : 'read', resource: fileResource(p) })
      continue
    }
    if (/^(read_text|write_text|read_bytes|write_bytes)$/.test(name) && recvPath) {
      const write = name.startsWith('write')
      addOp(c.fn, { cat: 'file', verb: write ? 'write' : 'read', line, lib: 'pathlib', target: recvPath, label: `${write ? 'Writes' : 'Reads'} ${shortSel(recvPath, 40)}`, rw: write ? 'write' : 'read', resource: fileResource(null) })
      continue
    }

    // LLM
    if ((rk === 'llm' || llmProvider) && /(chat\.completions\.create|messages\.create|messages\.stream|responses\.create|embeddings\.create|completions\.create|ChatCompletion\.create|Completion\.create|generate_content|\.invoke|\.ainvoke|\.predict|^ollama\.(chat|generate))$/.test(cc)) {
      const provider = llmProvider || 'LLM'
      const model = sel(c.kw?.model)
      addOp(c.fn, { cat: 'llm', verb: name, line, lib: provider, target: model || provider, label: `Calls ${provider}${model ? ' (' + model + ')' : ''}`, resource: { kind: 'llm', key: `llm:${provider.toLowerCase()}`, label: provider } })
      continue
    }

    // Auth
    if (/^(jwt\.(encode|decode)|bcrypt\.(hashpw|checkpw|gensalt)|werkzeug\.security\.(generate_password_hash|check_password_hash)|flask_login\.(login_user|logout_user)|flask_jwt_extended\.create_access_token)$/.test(cc) || /^pwd_context\.(hash|verify)$/.test(t)) {
      addOp(c.fn, { cat: 'auth', verb: name, line, lib: cc.split('.')[0], target: name, label: `Auth: ${name}`, resource: null })
      continue
    }
    // Email
    if ((rk === 'smtp' && /^(sendmail|send_message)$/.test(name)) || /^(yagmail\.SMTP\(\)\.send|resend\.Emails\.send)$/.test(cc) || (modules.has('sendgrid') && name === 'send')) {
      addOp(c.fn, { cat: 'email', verb: 'send', line, lib: segs[0], target: 'email', label: 'Sends an email', resource: { kind: 'email', key: 'email', label: 'Email' } })
      continue
    }
    // Processes
    if (/^(subprocess\.(run|Popen|call|check_call|check_output)|os\.(system|popen))$/.test(cc)) {
      const cmd = sel(c.args?.[0]) ?? c.args?.[0]?.l?.join(' ')
      addOp(c.fn, { cat: 'process', verb: name, line, lib: segs[0], target: cmd || 'command', label: `Runs ${cmd ? '`' + shortSel(cmd) + '`' : 'a shell command'}`, resource: { kind: 'process', key: 'process', label: 'Shell / processes' } })
      continue
    }
    // Jobs
    if ((t.startsWith('schedule.every') && name === 'do') || /^(scheduler|sched)\.add_job$/.test(t) || ((name === 'delay' || name === 'apply_async') && modules.has('celery'))) {
      addOp(c.fn, { cat: 'jobs', verb: name, line, lib: segs[0], target: t, label: name === 'do' || name === 'add_job' ? 'Runs on a schedule' : `Queues background task ${recvPath}`, resource: null })
      continue
    }
    // Realtime
    if ((modules.has('flask_socketio') || modules.has('socketio')) && name === 'emit') {
      addOp(c.fn, { cat: 'realtime', verb: 'emit', line, lib: 'socket.io', target: sel(c.args?.[0]) || 'event', label: `Emits "${sel(c.args?.[0]) || 'event'}"`, resource: { kind: 'realtime', key: 'realtime:socket', label: 'WebSocket / Socket.IO' } })
      continue
    }
    // Transforms
    if (hasPandas && TRANSFORMS.has(name) && (recvPath || /^(pandas|polars|numpy)\./.test(cc)) && !(name === 'filter' && !modules.has('polars')) && !(name === 'join' && !/df|frame|data/i.test(recvPath)) && !(name === 'apply' && !/df|frame|data|\]$/i.test(recvPath) && !rk)) {
      addOp(c.fn, { cat: 'transform', verb: name, line, lib: modules.has('polars') ? 'polars' : 'pandas', target: recvPath || cc, label: `${name}${recvPath ? ' on ' + shortSel(recvPath, 30) : ''}`, resource: null })
      continue
    }

    // Ports
    if ((/^(app|application|socketio)\.run$/.test(t) && (modules.has('flask') || modules.has('flask_socketio'))) || cc === 'uvicorn.run') {
      const port = c.kw?.port?.n ?? (cc === 'uvicorn.run' ? 8000 : 5000)
      out.ports.push({ port, line, kind: 'server' })
    }

    // Route registration via calls (flask-restful, Django urls, include_router/register_blueprint)
    if (name === 'add_resource' && c.args?.length >= 2) {
      const cls = c.args[0].t
      for (const a of c.args.slice(1)) if (a.s) out.routes.push({ method: 'ANY', path: a.s, line, recv: recv || 'api', framework: 'flask-restful', handler: { classRef: cls } })
      continue
    }
    if ((name === 'path' || name === 're_path' || name === 'url') && !recv && /urls\.py$/.test(file) && c.args?.length >= 2 && c.args[0].s != null) {
      const route = '/' + c.args[0].s.replace(/^\^|\$$/g, '').replace(/^\/+/, '')
      if (/^include\(/.test(c.args[1].t)) out.mounts.push({ prefix: route.replace(/\/$/, ''), module: c.args[1].inner, line })
      else out.routes.push({ method: 'ANY', path: route, line, recv: 'urlpatterns', framework: 'django', handler: { ref: c.args[1].t.replace(/\.as_view\(\)$/, '').split('.').pop(), recv: c.args[1].t.includes('.') ? c.args[1].t.split('.')[0] : null, classView: /as_view/.test(c.args[1].t) } })
      continue
    }
    if ((name === 'register_blueprint' || name === 'include_router') && c.args?.[0]) {
      const target = c.args[0].t
      const prefix = sel(c.kw?.url_prefix) ?? sel(c.kw?.prefix)
      out.mounts.push({ prefix: prefix ?? null, ident: target.split('.')[0], member: target.includes('.') ? target.split('.').slice(1).join('.') : null, recv, line })
      continue
    }
  }

  // ---- routes from decorators ----
  const framework = modules.has('fastapi') ? 'fastapi' : modules.has('flask') ? 'flask' : modules.has('django') ? 'django' : modules.has('aiohttp') ? 'aiohttp' : 'python'
  for (const f of out.functions) {
    for (const d of f.decorators || []) {
      const segs = d.text.split('.')
      const dn = segs[segs.length - 1]
      const recv = segs.slice(0, -1).join('.')
      if (recv && ['route', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'api_route', 'websocket'].includes(dn)) {
        const p = sel(d.args?.[0]) ?? sel(d.kw?.path) ?? sel(d.kw?.rule)
        if (p == null || !(p.startsWith('/') || p === '')) continue
        const methods = dn === 'route' || dn === 'api_route' ? d.kw?.methods?.l || ['GET'] : [dn === 'websocket' ? 'WS' : dn.toUpperCase()]
        for (const method of methods) out.routes.push({ method: method.toUpperCase(), path: p || '/', line: d.line, recv, framework, handler: { fn: f.qual } })
      }
      if (/^(task|shared_task|scheduled_job|periodic_task|cron)$/.test(dn) || d.text === 'shared_task') {
        addOp(f.qual, { cat: 'jobs', verb: 'task', line: d.line, lib: segs[0], target: f.qual, label: `Background task / scheduled job (@${d.text})`, resource: null })
      }
    }
  }
  return out
}
