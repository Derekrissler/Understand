// JavaScript / TypeScript extractor (Babel AST). Produces raw facts about one file:
// imports, exports, functions, calls (for the call graph), HTTP calls, routes,
// router mounts and crucial operations.
import { parse } from '@babel/parser'
import { parseUrl, hostResource, sqlInfo, sqlVerbKind, fileResource, dbResource, shortSel } from './ops.js'

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens', 'range', 'typeAnnotation', 'returnType', 'typeParameters', 'superTypeParameters'])
const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'del', 'head', 'options'])
const ROUTE_VERBS = new Set([...HTTP_VERBS, 'all'])
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassMethod', 'ClassPrivateMethod', 'ObjectMethod'])
const BUILTIN_RECV = new Set(['Object', 'Array', 'Promise', 'Math', 'JSON', 'Date', 'Number', 'String', 'Reflect', 'Map', 'Set', 'Symbol', 'Intl', 'URL', 'Buffer', 'React', 'Vue', 'Error', 'Response', 'Request', 'Headers', 'console', 'window', 'globalThis', 'process'])

export const DB_PKGS = {
  pg: 'PostgreSQL', 'pg-promise': 'PostgreSQL', postgres: 'PostgreSQL', '@vercel/postgres': 'PostgreSQL', '@neondatabase/serverless': 'PostgreSQL',
  mysql: 'MySQL', mysql2: 'MySQL', '@planetscale/database': 'MySQL', mssql: 'SQL Server', 'better-sqlite3': 'SQLite', sqlite3: 'SQLite', sqlite: 'SQLite',
  mongoose: 'MongoDB', mongodb: 'MongoDB', '@prisma/client': 'Prisma', knex: 'Knex', sequelize: 'Sequelize', typeorm: 'TypeORM',
  'drizzle-orm': 'Drizzle', '@supabase/supabase-js': 'Supabase', firebase: 'Firebase', 'firebase-admin': 'Firebase',
  redis: 'Redis', ioredis: 'Redis', '@upstash/redis': 'Redis', '@aws-sdk/client-dynamodb': 'DynamoDB', '@aws-sdk/lib-dynamodb': 'DynamoDB',
  lowdb: 'lowdb', nedb: 'NeDB', '@libsql/client': 'libSQL', 'convex': 'Convex',
}
export const LLM_PKGS = {
  openai: 'OpenAI', '@anthropic-ai/sdk': 'Anthropic', '@google/generative-ai': 'Gemini', '@google/genai': 'Gemini', ai: 'Vercel AI SDK',
  '@ai-sdk/openai': 'OpenAI', '@ai-sdk/anthropic': 'Anthropic', '@ai-sdk/google': 'Gemini', 'groq-sdk': 'Groq', '@mistralai/mistralai': 'Mistral',
  'cohere-ai': 'Cohere', ollama: 'Ollama', '@langchain/openai': 'LangChain', '@langchain/anthropic': 'LangChain', langchain: 'LangChain', replicate: 'Replicate',
}
export const SCRAPE_PKGS = {
  puppeteer: 'Puppeteer', 'puppeteer-core': 'Puppeteer', 'puppeteer-extra': 'Puppeteer', playwright: 'Playwright', 'playwright-core': 'Playwright',
  '@playwright/test': 'Playwright', cheerio: 'Cheerio', jsdom: 'jsdom', 'node-html-parser': 'node-html-parser', 'selenium-webdriver': 'Selenium',
  crawlee: 'Crawlee', htmlparser2: 'htmlparser2', 'x-ray': 'x-ray',
}
const MODEL_VERBS = new Set(['find', 'findOne', 'findById', 'findByIdAndUpdate', 'findByIdAndDelete', 'findOneAndUpdate', 'findOneAndDelete', 'create', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'countDocuments', 'aggregate', 'exists', 'distinct', 'findAll', 'findByPk', 'findOrCreate', 'bulkCreate', 'destroy', 'upsert', 'count', 'replaceOne'])
const MODEL_WRITE = /^(create|insert|update|delete|destroy|bulk|upsert|replace|findByIdAndUpdate|findByIdAndDelete|findOneAndUpdate|findOneAndDelete|findOrCreate)/i
const SQL_METHODS = new Set(['query', 'execute', 'prepare', 'run', 'all', 'get', 'exec', 'each', 'many', 'one', 'none', 'any', 'oneOrNone', 'manyOrNone', 'raw', 'unsafe', '$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'])
const FS_READ = new Set(['readFile', 'readFileSync', 'createReadStream', 'readdir', 'readdirSync', 'readJson', 'readJsonSync', 'readJSON', 'stat', 'statSync'])
const FS_WRITE = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream', 'unlink', 'unlinkSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'writeJson', 'writeJsonSync', 'outputFile', 'outputJson'])
const PAGE_METHODS = new Set(['goto', '$eval', '$$eval', '$', '$$', 'evaluate', 'waitForSelector', 'locator', 'click', 'type', 'fill', 'content', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'querySelector', 'querySelectorAll', 'getByRole', 'getByText', 'screenshot', 'pdf'])
const DOM_QUERY = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'getElementsByTagName', 'getElementsByName', 'evaluate'])

export function pkgOf(src) {
  if (!src || src.startsWith('.') || src.startsWith('/')) return null
  const s = src.replace(/^node:/, '')
  if (s.startsWith('@')) return s.split('/').slice(0, 2).join('/')
  return s.split('/')[0]
}

function parseJs(code, file) {
  const ts = /\.(ts|tsx|mts|cts)$/.test(file)
  const attempts = ts ? [/\.tsx$/.test(file) ? ['typescript', 'jsx'] : ['typescript']] : [['jsx'], ['jsx', 'typescript'], ['typescript']]
  let err
  for (const p of attempts) {
    try {
      return parse(code, {
        sourceType: 'unambiguous',
        plugins: [...p, 'decorators-legacy'],
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowAwaitOutsideFunction: true,
        allowUndeclaredExports: true,
      })
    } catch (e) {
      err = e
    }
  }
  throw err
}

/** /^\/courses\/(\d+)\/cover$/ -> /courses/:param/cover */
export function regexToPath(re) {
  let s = String(re).replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')
  s = s.replace(/\((\?<(\w+)>)?(?:[^()]|\([^()]*\))*\)\??/g, (m, named, name) => ':' + (name || 'param'))
  s = s.replace(/\\(.)/g, '$1').replace(/\/\?$/, '')
  return s.startsWith('/') ? s : '/' + s
}

export function calleeText(n, d = 0) {
  if (!n || d > 8) return '?'
  switch (n.type) {
    case 'Identifier': return n.name
    case 'ThisExpression': return 'this'
    case 'Super': return 'super'
    case 'Import': return 'import'
    case 'MetaProperty': return `${n.meta.name}.${n.property.name}`
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const p = n.property
      const name = n.computed ? (p.type === 'StringLiteral' ? p.value : '[]') : p.name ?? p.id?.name ?? '?'
      return `${calleeText(n.object, d + 1)}.${name}`
    }
    case 'CallExpression':
    case 'OptionalCallExpression': return `${calleeText(n.callee, d + 1)}()`
    case 'NewExpression': return `new ${calleeText(n.callee, d + 1)}()`
    case 'AwaitExpression': return calleeText(n.argument, d + 1)
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'ParenthesizedExpression': return calleeText(n.expression, d + 1)
    default: return '?'
  }
}

const rootOf = (text) => text.replace(/^new /, '').split('.')[0].replace(/\(\)$/, '')
const isFn = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression')

/**
 * @param {string} code
 * @param {string} file  project-relative path (used for parser choice)
 * @param {{ frontend?: boolean }} opts
 */
export function extractJs(code, file, opts = {}) {
  const out = {
    imports: [], exports: [], functions: [], calls: [], http: [], routes: [], mounts: [], ops: [],
    consts: {}, env: [], ports: [], errors: [], decoratedClasses: [], fields: {},
  }
  let ast
  try {
    ast = parseJs(code, file)
  } catch (e) {
    out.errors.push(String(e.message || e))
    return out
  }
  if (ast.errors?.length) out.errors.push(...ast.errors.slice(0, 3).map((e) => e.message))

  const totalLines = code.split('\n').length
  const consts = new Map()
  const objConsts = new Map()
  const numConsts = new Map()
  const pkgs = new Set()
  const bindings = new Map() // local -> { source, imported }
  const varKinds = new Map()
  const fnStack = [{ qual: '<module>', depth: 0 }]
  const classStack = []
  const ancestors = []
  const handlerMarks = new Map() // fn node -> route label
  out.functions.push({ name: '<module>', qual: '<module>', line: 1, endLine: totalLines, kind: 'module', params: [] })

  const cur = () => fnStack[fnStack.length - 1]
  const slice = (n) => (n && n.start != null ? code.slice(n.start, n.end) : '')
  const lineOf = (n) => n?.loc?.start?.line ?? 0

  const exprLabel = (e) => {
    if (!e) return '…'
    if (e.type === 'Identifier') return e.name
    if (e.type === 'MemberExpression' || e.type === 'OptionalMemberExpression') return calleeText(e)
    if (e.type === 'CallExpression') return calleeText(e.callee) + '()'
    return '…'
  }

  function strOf(n, d = 0) {
    if (!n || d > 6) return null
    switch (n.type) {
      case 'StringLiteral': return n.value
      case 'TemplateLiteral': {
        let s = ''
        n.quasis.forEach((q, i) => {
          s += q.value.cooked ?? q.value.raw
          if (i < n.expressions.length) {
            const e = n.expressions[i]
            const v = strOf(e, d + 1)
            s += v != null ? v : '${' + exprLabel(e) + '}'
          }
        })
        return s
      }
      case 'BinaryExpression': {
        if (n.operator !== '+') return null
        const l = strOf(n.left, d + 1)
        const r = strOf(n.right, d + 1)
        if (l == null && r == null) return null
        return (l ?? '${' + exprLabel(n.left) + '}') + (r ?? '${' + exprLabel(n.right) + '}')
      }
      case 'Identifier': {
        const pc = cur().pc
        if (pc?.has(n.name)) return pc.get(n.name)
        return consts.has(n.name) ? consts.get(n.name) : null
      }
      case 'MemberExpression': return objConsts.get(calleeText(n)) ?? null
      case 'CallExpression': {
        const t = calleeText(n.callee)
        if (/^(path\.)?(join|resolve)$/.test(t) && n.arguments.length) {
          return n.arguments.map((a) => strOf(a, d + 1) ?? '${' + exprLabel(a) + '}').join('/').replace(/\/{2,}/g, '/')
        }
        if (t === 'String' || t.endsWith('.toString')) return strOf(n.arguments[0], d + 1)
        return null
      }
      case 'NewExpression': {
        // new URL('/api/x', base)
        if (calleeText(n.callee) === 'URL') {
          const a = strOf(n.arguments[0], d + 1)
          if (a == null) return null
          if (/^https?:/.test(a) || n.arguments.length < 2) return a
          const b = strOf(n.arguments[1], d + 1)
          return (b ?? '${' + exprLabel(n.arguments[1]) + '}') + (a.startsWith('/') ? a : '/' + a)
        }
        return null
      }
      case 'TSAsExpression':
      case 'TSNonNullExpression':
      case 'TSSatisfiesExpression':
      case 'ParenthesizedExpression': return strOf(n.expression, d + 1)
      case 'LogicalExpression': return strOf(n.right, d + 1) ?? strOf(n.left, d + 1)
      default: return null
    }
  }

  function objProp(obj, key) {
    if (!obj || obj.type !== 'ObjectExpression') return undefined
    for (const p of obj.properties) {
      if (p.type !== 'ObjectProperty') continue
      const k = p.key.type === 'Identifier' ? p.key.name : p.key.value
      if (k === key) return p.value
    }
    return undefined
  }

  function docFor(node) {
    const cands = [node, ...ancestors.slice(-3).reverse()]
    for (const c of cands) {
      const cs = c?.leadingComments
      if (cs?.length) {
        const raw = cs[cs.length - 1].value
        const txt = raw.split('\n').map((l) => l.replace(/^\s*\*+\s?/, '').trim()).filter((l) => l && !l.startsWith('@')).join(' ')
        return txt.slice(0, 240) || null
      }
      if (c && c.type !== 'VariableDeclarator' && c.type !== 'VariableDeclaration' && c.type !== 'ExportNamedDeclaration' && c.type !== 'ExportDefaultDeclaration' && c !== node) break
    }
    return null
  }

  function paramInfo(p) {
    if (!p) return { name: '?' }
    const type = p.typeAnnotation?.typeAnnotation ? slice(p.typeAnnotation.typeAnnotation) : undefined
    switch (p.type) {
      case 'Identifier': return { name: p.name, type }
      case 'AssignmentPattern': return { ...paramInfo(p.left), default: slice(p.right).slice(0, 120) }
      case 'RestElement': return { ...paramInfo(p.argument), rest: true }
      case 'ObjectPattern': return { name: `{ ${p.properties.map((q) => q.key?.name ?? q.argument?.name ?? '…').join(', ')} }`, destructured: true, type }
      case 'ArrayPattern': return { name: '[…]', destructured: true, type }
      case 'TSParameterProperty': return paramInfo(p.parameter)
      default: return { name: slice(p).slice(0, 40) }
    }
  }

  // `function fetchPage(url = LISTINGS_URL)`: defaults let us resolve URLs built from params
  function paramDefaults(node, inherited) {
    let map = inherited ? new Map(inherited) : null
    for (const p of node.params || []) {
      if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
        const v = strOf(p.right)
        if (v != null) {
          map = map || new Map()
          map.set(p.left.name, v)
        }
      }
    }
    return map
  }

  // ---------- naming of function nodes ----------
  function fnName(node, parent, gp) {
    if (node.type === 'FunctionDeclaration') return node.id?.name
    if (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod' || node.type === 'ObjectMethod') {
      const k = node.key
      return k.type === 'Identifier' ? k.name : k.type === 'PrivateName' ? '#' + k.id.name : k.type === 'StringLiteral' ? k.value : null
    }
    if (!parent) return null
    if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
    if (parent.type === 'AssignmentExpression') {
      const t = calleeText(parent.left)
      const last = t.split('.').pop()
      if (t === 'module.exports' || t === 'exports.default') return 'default'
      return last && last !== '?' && last !== '[]' ? last : null
    }
    if (parent.type === 'ObjectProperty' && !parent.computed) return parent.key.name ?? parent.key.value
    if (parent.type === 'ClassProperty' || parent.type === 'ClassPrivateProperty' || parent.type === 'PropertyDefinition') {
      return parent.key?.name ?? parent.key?.id?.name
    }
    if (parent.type === 'ExportDefaultDeclaration') return 'default'
    // const X = memo(() => …), const h = asyncHandler(async (req, res) => …)
    if ((parent.type === 'CallExpression' || parent.type === 'TSAsExpression') && gp?.type === 'VariableDeclarator' && gp.id.type === 'Identifier') return gp.id.name
    if (parent.type === 'CallExpression' && gp?.type === 'ExportDefaultDeclaration') return 'default'
    return null
  }

  function objectOwner(parentObj, gp) {
    // name of the object literal a method lives in, when it is a module-level const or module.exports
    if (!gp) return null
    if (gp.type === 'VariableDeclarator' && gp.id.type === 'Identifier') return gp.id.name
    if (gp.type === 'AssignmentExpression' && calleeText(gp.left) === 'module.exports') return ''
    if (gp.type === 'ExportDefaultDeclaration') return ''
    return null
  }

  // ---------- receivers ----------
  function kindFromInit(init) {
    if (!init) return null
    let n = init
    while (n.type === 'AwaitExpression' || n.type === 'TSAsExpression' || n.type === 'TSNonNullExpression') n = n.argument ?? n.expression
    if (n.type !== 'CallExpression' && n.type !== 'NewExpression') return null
    const t = calleeText(n.callee)
    const b = bindings.get(rootOf(t))
    const src = b ? pkgOf(b.source) : null
    if (/^(express|fastify|Fastify|polka|koa|Koa|Hono|Elysia|Router|express\.Router|createRouter|Router\(\)|connect)$/.test(t) || t === 'require().Router') return 'router'
    if (n.type === 'NewExpression' && /^(Hono|Koa|Router|KoaRouter|Elysia)$/.test(t)) return 'router'
    if (/^(axios|ky|got|ofetch)\.(create|extend)$/.test(t) || (t === 'create' && src === 'axios') || t === '$fetch.create') return 'client'
    if (/(^|\.)load$/.test(t) && (src === 'cheerio' || t.startsWith('cheerio'))) return 'cheerio'
    if (/newPage$/.test(t)) return 'page'
    if (/(puppeteer|chromium|firefox|webkit)\.launch$/.test(t) || /\.(launch|connect)$/.test(t) && SCRAPE_PKGS[src]) return 'browser'
    if (/^new PrismaClient/.test('new ' + t) || t === 'PrismaClient') return 'prisma'
    if (/^(Pool|Client|Database|sqlite3\.Database|pg\.Pool|pg\.Client|mysql\.createPool|mysql\.createConnection|createPool|createConnection|postgres|neon|connect)$/.test(t) && (DB_PKGS[src] || /^(pg|mysql|sqlite3)\./.test(t))) return 'sqldb'
    if (t === 'knex' || (src === 'knex')) return 'knex'
    if (t === 'drizzle' || src === 'drizzle-orm' || /^drizzle/.test(t)) return 'drizzle'
    if (t === 'createClient' && src === '@supabase/supabase-js') return 'supabase'
    if ((t === 'createClient' || t === 'Redis' || t === 'redis.createClient') && (src === 'redis' || src === 'ioredis')) return 'redis'
    if (src && LLM_PKGS[src]) return `llm:${LLM_PKGS[src]}`
    if (/^(getFirestore|firestore|admin\.firestore)$/.test(t)) return 'firestore'
    if (/^(mongoose\.)?model$/.test(t)) return 'model'
    if (t === 'MongoClient' || t === 'mongodb.MongoClient') return 'mongo'
    if (/createTransport$/.test(t)) return 'mailer'
    if (t === 'Stripe' || src === 'stripe') return 'stripe'
    if (t === 'io' && src === 'socket.io-client') return 'socket'
    if ((t === 'Server' && src === 'socket.io') || t === 'socketIO') return 'io'
    if (t === 'Resend' || src === 'resend') return 'resend'
    return null
  }

  function strongClient(name) {
    if (varKinds.get(name) === 'client') return true
    const b = bindings.get(name)
    if (b && ['axios', 'ky', 'got'].includes(pkgOf(b.source))) return true
    return /^(axios|api|http|client|apiClient|httpClient|instance|\$http|ky|got)$/i.test(name || '')
  }

  function receiverRole(name, args) {
    const k = varKinds.get(name)
    if (k === 'router') return 'route'
    if (k === 'client') return 'client'
    if (['axios', 'ky', 'got', 'superagent', '$', 'jQuery', '$http', 'request'].includes(name)) return 'client'
    const b = bindings.get(name)
    if (b) {
      const p = pkgOf(b.source)
      if (p === 'axios' || p === 'ky' || p === 'got') return 'client'
    }
    const hasFnArg = args.slice(1).some((a) => isFn(a) || (a.type === 'CallExpression' && a.arguments.some(isFn)))
    if (hasFnArg) return 'route'
    if (/^(app|server|routes?|fastify|hono)$|router$/i.test(name || '')) return 'route'
    if (/(api|http|client|axios|request|instance|fetcher|service|backend)/i.test(name || '')) return 'client'
    return null
  }

  // ---------- recording ----------
  function addOp(op) {
    out.ops.push({ fn: cur().qual, ...op })
  }

  function addHttp(node, { method, url, lib, methodParam }) {
    const raw = url
    const parsed = parseUrl(raw)
    const rec = { fn: cur().qual, line: lineOf(node), method: (method || 'GET').toUpperCase(), url: raw, lib, parsed, methodParam: methodParam || undefined }
    out.http.push(rec)
    const target = raw ?? '(dynamic URL)'
    let resource = null
    if (parsed.kind === 'external') resource = hostResource(parsed.host)
    addOp({ cat: 'http', verb: rec.method, line: rec.line, lib, target, label: `${rec.method} ${shortSel(target, 64)}`, resource, httpIndex: out.http.length - 1 })
  }

  function addRoute(node, method, path, handlers, recv, framework = 'express') {
    const route = { method: method === 'DEL' ? 'DELETE' : method, path, line: lineOf(node), recv, framework, handler: null, fn: cur().qual }
    const h = handlers[handlers.length - 1]
    if (h) {
      if (isFn(h)) {
        route.handler = { inline: `${route.method} ${path}` }
        handlerMarks.set(h, route.handler.inline)
      } else if (h.type === 'CallExpression' && h.arguments.some(isFn)) {
        const f = h.arguments.find(isFn)
        route.handler = { inline: `${route.method} ${path}` }
        handlerMarks.set(f, route.handler.inline)
      } else if (h.type === 'Identifier') route.handler = { ref: h.name }
      else if (h.type === 'MemberExpression') {
        const t = calleeText(h)
        route.handler = { ref: t.split('.').pop(), recv: rootOf(t) }
      }
    }
    out.routes.push(route)
  }

  function onImport(source, names, node, kind = 'import', typeOnly = false) {
    out.imports.push({ source, names, line: lineOf(node), kind, typeOnly })
    const p = pkgOf(source)
    if (p) {
      pkgs.add(p)
      if (source.startsWith('firebase/')) pkgs.add(source)
    }
    if (!typeOnly) for (const nm of names) bindings.set(nm.local, { source, imported: nm.imported })
  }

  function handleTopImport(st) {
    if (st.type === 'ImportDeclaration') {
      const names = st.specifiers.map((s) =>
        s.type === 'ImportDefaultSpecifier' ? { local: s.local.name, imported: 'default' }
          : s.type === 'ImportNamespaceSpecifier' ? { local: s.local.name, imported: '*' }
            : { local: s.local.name, imported: s.imported?.name ?? s.imported?.value ?? s.local.name })
      onImport(st.source.value, names, st, 'import', st.importKind === 'type')
      for (const nm of names) {
        const p = pkgOf(st.source.value)
        if (p === 'express' && nm.imported === 'Router') varKinds.set(nm.local, 'routerFactory')
      }
    }
  }

  // ---------- call handling ----------
  function onCall(node) {
    const callee = node.callee
    const args = node.arguments || []
    const isNew = node.type === 'NewExpression'
    const text = calleeText(callee)
    const segs = text.split('.')
    const name = segs[segs.length - 1].replace(/\(\)$/, '')
    const recv = segs.length > 1 ? rootOf(text) : null
    const line = lineOf(node)
    const fn = cur().qual
    const recvBinding = recv ? bindings.get(recv) : bindings.get(name)
    const srcPkg = recvBinding ? pkgOf(recvBinding.source) : null

    if (callee.type === 'Identifier' || callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      if (!BUILTIN_RECV.has(recv) && out.calls.length < 8000) {
        // literal (or ${identifier}) argument values let us push URLs through API wrappers later
        const argv = args.slice(0, 5).map((a) => strOf(a) ?? (a.type === 'Identifier' ? '${' + a.name + '}' : null))
        out.calls.push({ fn, name, recv, text, line, args: argv.some((v) => v != null) ? argv : undefined, argText: args.length ? args.slice(0, 5).map((a) => slice(a).slice(0, 80)) : undefined })
      }
    }

    // Hand-rolled routers and API helpers: on('GET', '/path', handler) / apiSend('POST', '/path', body)
    if (args.length >= 2 && args[0].type === 'StringLiteral' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL|ANY)$/.test(args[0].value)) {
      const p = strOf(args[1])
      if (p != null && (p.startsWith('/') || /^\$\{[^}]+\}\//.test(p))) {
        const h = args[2]
        const fnLike = h && (isFn(h) || (h.type === 'CallExpression' && h.arguments.some(isFn)))
        if (fnLike || (h && /^(on|route|add|addRoute|handle|register|map|router|endpoint)$/i.test(name))) {
          addRoute(node, args[0].value, p, args.slice(2), recv || name, 'custom')
          return
        }
      }
    }

    // require()
    if (callee.type === 'Identifier' && callee.name === 'require' && args[0]?.type === 'StringLiteral') {
      const parent = ancestors[ancestors.length - 1]
      if (!(parent?.type === 'VariableDeclarator' && parent.init === node)) onImport(args[0].value, [], node, 'require')
      return
    }

    // ---- routes & clients via .get/.post/... ----
    const isMember = callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression'
    if (isMember && ROUTE_VERBS.has(name) && args.length) {
      let path = null
      let recvName = recv
      const obj = callee.object
      if (obj.type === 'CallExpression' && calleeText(obj.callee).endsWith('.route') && obj.arguments[0]) {
        path = strOf(obj.arguments[0])
        recvName = rootOf(calleeText(obj.callee))
        if (path != null) { addRoute(node, name.toUpperCase(), path, args, recvName); return }
      }
      path = strOf(args[0])
      // this.http.get(...) (Angular-style injected clients): judge by the member name
      if (recvName === 'this' && segs.length >= 3) recvName = segs[1]
      const role = receiverRole(recvName, args)
      if (role === 'route' && path != null && (path.startsWith('/') || path === '*')) {
        addRoute(node, name.toUpperCase(), path, args.slice(1), recvName, varKinds.get(recvName) === 'router' ? 'express' : 'express')
        return
      }
      if (role === 'client' && HTTP_VERBS.has(name) && name !== 'options') {
        const urlish = path != null ? /^(\/|https?:|\$\{|\.\.?\/)/.test(path) || /^[\w-]+\/[\w${}/.?=&-]*$/.test(path) : strongClient(recvName)
        if (urlish) {
          addHttp(node, { method: name === 'del' ? 'DELETE' : name, url: path ?? (args[0]?.type === 'Identifier' ? '${' + args[0].name + '}' : null), lib: srcPkg || recvName })
          return
        }
      }
    }
    // app.use('/api', router) / app.route('/x', sub) / fastify.register(plugin, { prefix })
    if (isMember && (name === 'use' || name === 'route' || name === 'register') && args.length) {
      const role = receiverRole(recv, [])
      if (role === 'route' || varKinds.get(recv) === 'router') {
        let prefix = ''
        let targets = args
        if (name === 'register') {
          const p = strOf(objProp(args[1], 'prefix'))
          prefix = p || ''
          targets = [args[0]]
        } else if (args[0] && strOf(args[0]) != null) {
          prefix = strOf(args[0])
          targets = args.slice(1)
        }
        for (const t of targets) {
          if (t.type === 'Identifier') out.mounts.push({ prefix, ident: t.name, recv, line })
          else if (t.type === 'CallExpression' && calleeText(t.callee) === 'require' && t.arguments[0]?.type === 'StringLiteral') {
            out.mounts.push({ prefix, source: t.arguments[0].value, recv, line })
            onImport(t.arguments[0].value, [], t, 'require')
          } else if (t.type === 'MemberExpression') out.mounts.push({ prefix, ident: rootOf(calleeText(t)), member: calleeText(t).split('.').pop(), recv, line })
        }
        if (name === 'route' && args.length >= 2) return
      }
    }

    // listen(port)
    if (name === 'listen' && args[0]) {
      const a = args[0]
      const port = a.type === 'NumericLiteral' ? a.value : a.type === 'Identifier' ? numConsts.get(a.name) : a.type === 'LogicalExpression' && a.right.type === 'NumericLiteral' ? a.right.value : null
      if (port) out.ports.push({ port, line, kind: 'server' })
    }

    // ---- fetch-like ----
    if (callee.type === 'Identifier') {
      const c = callee.name
      if (['fetch', '$fetch', 'ofetch', 'useFetch', 'got', 'ky', 'needle', 'phin', 'superagent'].includes(c) || (c === 'request' && srcPkg === 'request') || (c === 'useSWR' && args[0] && strOf(args[0])?.startsWith('/'))) {
        const mNode = objProp(args[1], 'method')
        const method = strOf(mNode)
        addHttp(node, { method: method || 'GET', url: strOf(args[0]) ?? (args[0]?.type === 'Identifier' ? '${' + args[0].name + '}' : null), lib: c, methodParam: !method && mNode?.type === 'Identifier' ? mNode.name : null })
        return
      }
      if (c === 'axios' || (srcPkg === 'axios' && recvBinding?.imported === 'default')) {
        if (args[0]?.type === 'ObjectExpression') {
          const mNode = objProp(args[0], 'method')
          const uNode = objProp(args[0], 'url')
          addHttp(node, { method: strOf(mNode) || 'GET', url: strOf(uNode) ?? (uNode?.type === 'Identifier' ? '${' + uNode.name + '}' : null), lib: 'axios', methodParam: !strOf(mNode) && mNode?.type === 'Identifier' ? mNode.name : null })
        }
        else addHttp(node, { method: strOf(objProp(args[1], 'method')) || 'GET', url: strOf(args[0]), lib: 'axios' })
        return
      }
    }
    if (isMember && name === 'request' && receiverRole(recv, []) === 'client' && args[0]?.type === 'ObjectExpression') {
      addHttp(node, { method: strOf(objProp(args[0], 'method')) || 'GET', url: strOf(objProp(args[0], 'url')), lib: srcPkg || recv })
      return
    }
    if (isMember && (recv === '$' || recv === 'jQuery') && ['ajax', 'get', 'post', 'getJSON'].includes(name)) {
      if (name === 'ajax') addHttp(node, { method: strOf(objProp(args[0], 'type')) || strOf(objProp(args[0], 'method')) || 'GET', url: args[0]?.type === 'ObjectExpression' ? strOf(objProp(args[0], 'url')) : strOf(args[0]), lib: 'jQuery' })
      else addHttp(node, { method: name === 'post' ? 'POST' : 'GET', url: strOf(args[0]), lib: 'jQuery' })
      return
    }
    if (isMember && name === 'open' && args.length >= 2 && args[0].type === 'StringLiteral' && HTTP_VERBS.has(args[0].value.toLowerCase())) {
      addHttp(node, { method: args[0].value, url: strOf(args[1]), lib: 'XMLHttpRequest' })
      return
    }
    if (isNew && text === 'EventSource') { addHttp(node, { method: 'GET', url: strOf(args[0]), lib: 'EventSource' }); return }
    if (isMember && text === 'navigator.sendBeacon') { addHttp(node, { method: 'POST', url: strOf(args[0]), lib: 'sendBeacon' }); return }
    if (isMember && /^https?\.(get|request)$/.test(text) && (srcPkg === 'http' || srcPkg === 'https' || recv === 'http' || recv === 'https')) {
      const u = strOf(args[0])
      addHttp(node, { method: name === 'get' ? 'GET' : strOf(objProp(args[0], 'method')) || 'GET', url: u, lib: recv })
      return
    }

    // ---- realtime ----
    if ((isNew && text === 'WebSocket') || (callee.type === 'Identifier' && name === 'io' && srcPkg === 'socket.io-client')) {
      const u = strOf(args[0])
      addOp({ cat: 'realtime', verb: 'connect', line, lib: isNew ? 'WebSocket' : 'socket.io', target: u || 'server', label: `Opens ${isNew ? 'WebSocket' : 'Socket.IO'} connection${u ? ' to ' + shortSel(u) : ''}`, resource: { kind: 'realtime', key: 'realtime:socket', label: 'WebSocket / Socket.IO' } })
      return
    }
    if (isMember && (name === 'emit' || name === 'on') && (['socket', 'io'].includes(varKinds.get(recv)) || /^(socket|io|ws)$/.test(recv)) && args[0]?.type === 'StringLiteral' && !['connection', 'connect', 'disconnect', 'error'].includes(args[0].value)) {
      addOp({ cat: 'realtime', verb: name, line, lib: 'socket.io', target: args[0].value, label: `${name === 'emit' ? 'Emits' : 'Listens for'} "${args[0].value}"`, resource: { kind: 'realtime', key: 'realtime:socket', label: 'WebSocket / Socket.IO' } })
      return
    }

    // ---- scraping ----
    const rk = varKinds.get(recv)
    if (isMember && (rk === 'page' || (recv === 'page' && [...pkgs].some((p) => SCRAPE_PKGS[p]))) && PAGE_METHODS.has(name)) {
      const a = strOf(args[0])
      if (name === 'goto') {
        const u = parseUrl(a)
        addOp({ cat: 'scrape', verb: 'load', line, lib: 'browser', target: a || '(dynamic URL)', label: `Opens page ${shortSel(a || '(dynamic URL)', 60)} in a headless browser`, resource: u.kind === 'external' ? hostResource(u.host, 'web') : { kind: 'web', key: 'web:pages', label: 'web pages' } })
      } else {
        addOp({ cat: 'scrape', verb: 'select', line, lib: 'browser', target: a || name, label: a ? `Extracts \`${shortSel(a)}\` from the page` : `page.${name}()`, resource: null })
      }
      return
    }
    if (rk === 'browser' || /(puppeteer|chromium|firefox|webkit)\.launch$/.test(text)) {
      if (/launch$/.test(name)) addOp({ cat: 'scrape', verb: 'launch', line, lib: rootOf(text), target: 'browser', label: 'Launches a headless browser', resource: null })
      return
    }
    if (callee.type === 'Identifier' && varKinds.get(name) === 'cheerio' && args[0]) {
      const sel = strOf(args[0])
      if (sel) addOp({ cat: 'scrape', verb: 'select', line, lib: 'cheerio', target: sel, label: `Selects \`${shortSel(sel)}\` from HTML`, resource: null })
      return
    }
    if (/(^|\.)load$/.test(text) && (srcPkg === 'cheerio' || text.startsWith('cheerio'))) {
      addOp({ cat: 'scrape', verb: 'parse', line, lib: 'cheerio', target: 'HTML', label: 'Parses HTML with Cheerio', resource: null })
      return
    }
    if (isNew && text === 'JSDOM') { addOp({ cat: 'scrape', verb: 'parse', line, lib: 'jsdom', target: 'HTML', label: 'Parses HTML with jsdom', resource: null }); return }

    // ---- DOM ----
    if (isMember && DOM_QUERY.has(name) && /^(document|.*\.document|window\.document)$/.test(segs.slice(0, -1).join('.')) && name !== 'evaluate') {
      const sel = strOf(args[0])
      addOp({ cat: 'dom', verb: 'query', line, lib: 'DOM', target: sel || name, label: `Reads page element ${sel ? '`' + shortSel(sel) + '`' : name}`, resource: { kind: 'dom', key: 'dom:page', label: 'Page DOM' } })
      return
    }

    // ---- DB ----
    const dbEngine = [...pkgs].map((p) => DB_PKGS[p]).find(Boolean)
    if (rk === 'prisma' || recv === 'prisma') {
      if (segs.length >= 3 && !segs[1].startsWith('$')) {
        const table = segs[1]
        const verb = name
        addOp({ cat: 'db', verb, line, lib: 'Prisma', target: table, label: `${/^(find|count|aggregate|group)/.test(verb) ? 'Reads' : 'Writes'} ${table} (prisma.${table}.${verb})`, rw: /^(find|count|aggregate|group)/.test(verb) ? 'read' : 'write', resource: dbResource(table, 'Prisma') })
        return
      }
    }
    if (isMember && SQL_METHODS.has(name) && (rk === 'sqldb' || rk === 'prisma' || ((dbEngine || recv === 'sql') && /^(db|pool|client|conn|connection|database|sql|pg|mysql|sqlite|prisma|this)$/i.test(recv)))) {
      const s = strOf(args[0]) ?? (args[0]?.type === 'TemplateLiteral' ? args[0].quasis.map((q) => q.value.cooked).join('?') : null)
      const info = sqlInfo(s)
      if (info || name === 'query' || name === 'execute' || name.startsWith('$')) {
        const tables = info?.tables?.length ? info.tables : [null]
        for (const t of tables) {
          addOp({ cat: 'db', verb: info?.verb || name, line, lib: dbEngine || 'SQL', target: t || (s ? shortSel(s) : 'SQL'), label: info ? `${info.verb} ${t ?? ''}`.trim() + ' (SQL)' : `Runs SQL via ${recv}.${name}()`, rw: info ? sqlVerbKind(info.verb) : 'read', sql: s ? s.slice(0, 400) : null, resource: dbResource(t, dbEngine) })
        }
        return
      }
    }
    if (isMember && name === 'from' && (rk === 'supabase' || recv === 'supabase')) {
      const t = strOf(args[0])
      addOp({ cat: 'db', verb: 'from', line, lib: 'Supabase', target: t || 'table', label: `Supabase table ${t ?? '(dynamic)'}`, resource: dbResource(t, 'Supabase') })
      return
    }
    if (((callee.type === 'Identifier' && /^(collection|doc|collectionGroup)$/.test(name)) || (isMember && name === 'collection')) && (pkgs.has('firebase/firestore') || pkgs.has('firebase-admin') || pkgs.has('firebase') || pkgs.has('mongodb') || rk === 'firestore' || rk === 'mongo')) {
      const t = args.map((a) => strOf(a)).find((x) => x)
      if (t) {
        addOp({ cat: 'db', verb: name, line, lib: dbEngine || 'Firestore', target: t, label: `Collection ${t}`, resource: dbResource(t, dbEngine || 'Firestore') })
        return
      }
    }
    if (callee.type === 'Identifier' && /^(getDocs|getDoc|addDoc|setDoc|updateDoc|deleteDoc|onSnapshot)$/.test(name) && (pkgs.has('firebase/firestore') || pkgs.has('firebase'))) {
      addOp({ cat: 'db', verb: name, line, lib: 'Firestore', target: name, label: `Firestore ${name}()`, rw: /^(get|on)/.test(name) ? 'read' : 'write', resource: null })
      return
    }
    if (callee.type === 'Identifier' && rk === 'knex' && args[0]) {
      const t = strOf(args[0])
      if (t) { addOp({ cat: 'db', verb: 'query', line, lib: 'Knex', target: t, label: `Knex query on ${t}`, resource: dbResource(t, 'Knex') }); return }
    }
    if (isMember && (rk === 'drizzle' || pkgs.has('drizzle-orm')) && /^(from|insert|update|delete)$/.test(name) && args[0]?.type === 'Identifier') {
      const t = args[0].name
      addOp({ cat: 'db', verb: name, line, lib: 'Drizzle', target: t, label: `${name === 'from' ? 'Reads' : 'Writes'} ${t} (Drizzle)`, rw: name === 'from' ? 'read' : 'write', resource: dbResource(t, 'Drizzle') })
      return
    }
    if (isMember && MODEL_VERBS.has(name) && recv && /^[A-Z]/.test(recv) && !BUILTIN_RECV.has(recv) && (varKinds.get(recv) === 'model' || (recvBinding && recvBinding.source.startsWith('.') && (pkgs.has('mongoose') || pkgs.has('sequelize') || /model/i.test(recvBinding.source) || /model/i.test(file))))) {
      addOp({ cat: 'db', verb: name, line, lib: dbEngine || 'ORM', target: recv, label: `${MODEL_WRITE.test(name) ? 'Writes' : 'Reads'} ${recv} (${name})`, rw: MODEL_WRITE.test(name) ? 'write' : 'read', resource: dbResource(recv, dbEngine) })
      return
    }
    if (isMember && rk === 'redis') {
      addOp({ cat: 'db', verb: name, line, lib: 'Redis', target: strOf(args[0]) || name, label: `Redis ${name.toUpperCase()}${strOf(args[0]) ? ' ' + shortSel(strOf(args[0]), 30) : ''}`, resource: dbResource(null, 'Redis') })
      return
    }

    // ---- files ----
    const fsRecv = recv && (/^(fs|fsp|fse|fsExtra|fsPromises)$/.test(recv) || text.startsWith('fs.promises') || ['fs', 'fs/promises', 'fs-extra', 'graceful-fs'].includes(srcPkg))
    const fsBare = callee.type === 'Identifier' && recvBinding && ['fs', 'fs/promises', 'fs-extra'].includes(recvBinding.source.replace(/^node:/, ''))
    if ((fsRecv || fsBare) && /^(mkdir|mkdirSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|stat|statSync|readdir|readdirSync)$/.test(name)) return // housekeeping, not data
    if ((fsRecv || fsBare) && (FS_READ.has(name) || FS_WRITE.has(name))) {
      const p = strOf(args[0])
      const write = FS_WRITE.has(name)
      addOp({ cat: 'file', verb: write ? 'write' : 'read', line, lib: 'fs', target: p || '(dynamic path)', label: `${write ? 'Writes' : 'Reads'} ${p ? shortSel(fileResource(p).label, 60) : 'a file'}`, rw: write ? 'write' : 'read', resource: fileResource(p) })
      return
    }

    // ---- LLM ----
    const llmKind = rk?.startsWith('llm:') ? rk.slice(4) : null
    const llmPkg = [...pkgs].map((p) => LLM_PKGS[p]).find(Boolean)
    if ((llmKind || llmPkg) && /(chat\.completions\.create|responses\.create|messages\.create|messages\.stream|embeddings\.create|completions\.create|generateContent|generateContentStream|generateText|streamText|generateObject|streamObject|models\.generateContent|\.invoke)$/.test(text)) {
      const provider = llmKind || llmPkg
      const model = strOf(objProp(args[0], 'model'))
      addOp({ cat: 'llm', verb: name, line, lib: provider, target: model || provider, label: `Calls ${provider}${model ? ' (' + model + ')' : ''}`, resource: { kind: 'llm', key: `llm:${provider.toLowerCase()}`, label: provider } })
      return
    }

    // ---- auth ----
    if ((/^(jwt|jsonwebtoken)\.(sign|verify|decode)$/.test(text)) || /^(bcrypt|bcryptjs|argon2)\.(hash|compare|hashSync|compareSync|verify)$/.test(text) || text === 'passport.authenticate' ||
      (callee.type === 'Identifier' && /^(signInWithEmailAndPassword|createUserWithEmailAndPassword|signInWithPopup|getServerSession|signIn|signOut)$/.test(name) && recvBinding) || text.startsWith('supabase.auth.')) {
      addOp({ cat: 'auth', verb: name, line, lib: rootOf(text), target: name, label: `Auth: ${text.replace(/\(\)/g, '')}`, resource: null })
      return
    }

    // ---- browser storage ----
    if (isMember && /^(localStorage|sessionStorage|window\.localStorage|window\.sessionStorage)$/.test(segs.slice(0, -1).join('.')) && /^(getItem|setItem|removeItem|clear)$/.test(name)) {
      const store = segs[segs.length - 2]
      const key = strOf(args[0])
      addOp({ cat: 'storage', verb: name, line, lib: store, target: key || store, label: `${name === 'getItem' ? 'Reads' : 'Writes'} ${store}${key ? ' "' + key + '"' : ''}`, rw: name === 'getItem' ? 'read' : 'write', resource: { kind: 'storage', key: `storage:${store}`, label: store } })
      return
    }
    if (/^chrome\.storage\.\w+\.(get|set|remove)$/.test(text) || /^chrome\.runtime\.sendMessage$/.test(text) || text === 'indexedDB.open') {
      const isMsg = text.includes('sendMessage')
      addOp({ cat: isMsg ? 'realtime' : 'storage', verb: name, line, lib: 'browser', target: text, label: isMsg ? 'Sends an extension message' : `Extension storage ${name}`, resource: isMsg ? { kind: 'realtime', key: 'realtime:extension', label: 'extension messaging' } : { kind: 'storage', key: 'storage:extension', label: 'extension storage' } })
      return
    }

    // ---- email / payments / process / jobs ----
    if (isMember && (name === 'sendMail' || /^resend\.emails\.send$/.test(text) || /^(sgMail|sendgrid)\.send$/.test(text) || (rk === 'resend' && name === 'send'))) {
      addOp({ cat: 'email', verb: 'send', line, lib: recv, target: 'email', label: 'Sends an email', resource: { kind: 'email', key: 'email', label: 'Email' } })
      return
    }
    if (recv && (rk === 'stripe' || recv === 'stripe') && segs.length >= 3) {
      addOp({ cat: 'payments', verb: name, line, lib: 'Stripe', target: segs.slice(1).join('.'), label: `Stripe ${segs.slice(1).join('.').replace(/\(\)/g, '')}`, resource: { kind: 'payments', key: 'payments:stripe', label: 'Stripe' } })
      return
    }
    const cpBare = callee.type === 'Identifier' && recvBinding && recvBinding.source.replace(/^node:/, '') === 'child_process'
    if ((cpBare || /^(child_process|cp|childProcess)$/.test(recv || '')) && /^(exec|execSync|spawn|spawnSync|execFile|execFileSync|fork)$/.test(name)) {
      const cmd = strOf(args[0])
      addOp({ cat: 'process', verb: name, line, lib: 'child_process', target: cmd || 'command', label: `Runs ${cmd ? '`' + shortSel(cmd) + '`' : 'a shell command'}`, resource: { kind: 'process', key: 'process', label: 'Shell / processes' } })
      return
    }
    if (/^(cron\.schedule|schedule\.scheduleJob|agenda\.every)$/.test(text) || (isNew && text === 'CronJob') || (callee.type === 'Identifier' && name === 'setInterval' && cur().qual === '<module>')) {
      const when = strOf(args[0]) || (args[1]?.type === 'NumericLiteral' ? `${args[1].value}ms` : '')
      addOp({ cat: 'jobs', verb: 'schedule', line, lib: rootOf(text), target: when || 'interval', label: `Runs on a schedule${when ? ' (' + when + ')' : ''}`, resource: null })
      return
    }
  }

  function onDeclarator(node) {
    const id = node.id
    const init = node.init
    if (!init) return
    // require bindings
    let req = init
    while (req && (req.type === 'AwaitExpression')) req = req.argument
    const reqCall = req?.type === 'CallExpression' && calleeText(req.callee) === 'require' && req.arguments[0]?.type === 'StringLiteral' ? req : null
    const reqMember = req?.type === 'MemberExpression' && req.object.type === 'CallExpression' && calleeText(req.object.callee) === 'require' && req.object.arguments[0]?.type === 'StringLiteral' ? req : null
    const dyn = req?.type === 'ImportExpression' && req.source?.type === 'StringLiteral' ? req : null
    if (reqCall || reqMember || dyn) {
      const source = reqCall ? reqCall.arguments[0].value : reqMember ? reqMember.object.arguments[0].value : dyn.source.value
      let names = []
      if (id.type === 'Identifier') names = [{ local: id.name, imported: reqMember ? reqMember.property.name : 'default' }]
      else if (id.type === 'ObjectPattern') names = id.properties.filter((p) => p.type === 'ObjectProperty').map((p) => ({ local: p.value.name ?? p.key.name, imported: p.key.name ?? p.key.value }))
      onImport(source, names, node, dyn ? 'dynamic' : 'require')
      if (pkgOf(source) === 'express' && id.type === 'Identifier' && !reqMember) varKinds.set(id.name, 'expressFactory')
      return
    }
    if (id.type !== 'Identifier') return
    // receiver kinds
    const k = kindFromInit(init)
    if (k) varKinds.set(id.name, k)
    else if (init.type === 'CallExpression' && init.callee.type === 'Identifier' && ['expressFactory', 'routerFactory'].includes(varKinds.get(init.callee.name))) varKinds.set(id.name, 'router')
    else if (init.type === 'CallExpression' && /\.Router$/.test(calleeText(init.callee)) && ['expressFactory'].includes(varKinds.get(rootOf(calleeText(init.callee))))) varKinds.set(id.name, 'router')
    else if (init.type === 'CallExpression' && calleeText(init.callee) === 'require().Router') varKinds.set(id.name, 'router')
    // strings built inside a function: const url = `${BASE}/items/${id}`
    if (cur().qual !== '<module>' || cur().depth > 0) {
      const v = strOf(init)
      if (v != null && init.type !== 'Identifier') {
        const frame = cur()
        frame.pc = frame.pc ? new Map(frame.pc) : new Map()
        frame.pc.set(id.name, v)
      }
    }
    // module-level constants (for URL resolution)
    if (cur().qual === '<module>') {
      const s = strOf(init)
      if (s != null && (init.type !== 'Identifier')) {
        consts.set(id.name, s)
        out.consts[id.name] = s
      }
      if (init.type === 'NumericLiteral') numConsts.set(id.name, init.value)
      if (init.type === 'LogicalExpression' && init.right.type === 'NumericLiteral') numConsts.set(id.name, init.right.value)
      if (init.type === 'CallExpression' && /^(parseInt|Number)$/.test(calleeText(init.callee))) {
        const a = init.arguments[0]
        if (a?.type === 'LogicalExpression' && /Literal$/.test(a.right.type)) numConsts.set(id.name, Number(a.right.value))
      }
      if (init.type === 'ObjectExpression') {
        for (const p of init.properties) {
          if (p.type !== 'ObjectProperty' || p.computed) continue
          const v = strOf(p.value)
          const key = p.key.name ?? p.key.value
          if (v != null) {
            objConsts.set(`${id.name}.${key}`, v)
            out.consts[`${id.name}.${key}`] = v
          }
        }
      }
    }
  }

  function onExport(node) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.source) {
        onImport(node.source.value, node.specifiers.map((s) => ({ local: s.exported.name ?? s.exported.value, imported: s.local?.name ?? s.exported.name })), node, 'reexport')
        for (const s of node.specifiers) out.exports.push({ name: s.exported.name ?? s.exported.value, local: null, from: node.source.value, imported: s.local?.name })
        return
      }
      const d = node.declaration
      if (d?.type === 'FunctionDeclaration' || d?.type === 'ClassDeclaration' || d?.type === 'TSEnumDeclaration') { if (d.id) out.exports.push({ name: d.id.name, local: d.id.name }) }
      else if (d?.type === 'VariableDeclaration') for (const v of d.declarations) { if (v.id.type === 'Identifier') out.exports.push({ name: v.id.name, local: v.id.name }) }
      for (const s of node.specifiers || []) out.exports.push({ name: s.exported.name ?? s.exported.value, local: s.local.name })
    } else if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) out.exports.push({ name: 'default', local: d.id.name })
      else if (d.type === 'Identifier') out.exports.push({ name: 'default', local: d.name })
      else if (d.type === 'CallExpression') {
        const inner = d.arguments.find((a) => a.type === 'Identifier')
        out.exports.push({ name: 'default', local: inner ? inner.name : 'default' })
      } else out.exports.push({ name: 'default', local: 'default' })
    } else if (node.type === 'ExportAllDeclaration') {
      onImport(node.source.value, [], node, 'reexport')
      out.exports.push({ name: '*', local: null, from: node.source.value })
    }
  }

  function onAssign(node) {
    const left = calleeText(node.left)
    const right = node.right
    if (left === 'module.exports' || left === 'exports.default') {
      if (right.type === 'Identifier') out.exports.push({ name: 'default', local: right.name, cjs: true })
      else if (right.type === 'ObjectExpression') {
        for (const p of right.properties) {
          if (p.type === 'ObjectProperty' && !p.computed) {
            const key = p.key.name ?? p.key.value
            const local = p.value.type === 'Identifier' ? p.value.name : key
            out.exports.push({ name: key, local, cjs: true })
          } else if (p.type === 'ObjectMethod') out.exports.push({ name: p.key.name, local: p.key.name, cjs: true })
        }
      } else if (isFn(right) || right.type === 'ClassExpression') out.exports.push({ name: 'default', local: right.id?.name || 'default', cjs: true })
      else if (right.type === 'CallExpression' && right.callee.type === 'Identifier' && ['expressFactory', 'routerFactory'].includes(varKinds.get(right.callee.name))) out.exports.push({ name: 'default', local: null, cjs: true })
    } else if (/^(module\.)?exports\.\w+$/.test(left)) {
      const key = left.split('.').pop()
      out.exports.push({ name: key, local: right.type === 'Identifier' ? right.name : key, cjs: true })
    }
  }

  function onClass(node) {
    const name = node.id?.name || (ancestors[ancestors.length - 1]?.type === 'VariableDeclarator' ? ancestors[ancestors.length - 1].id.name : 'AnonymousClass')
    // NestJS controllers
    const decos = node.decorators || []
    const ctrl = decos.find((d) => d.expression.type === 'CallExpression' && calleeText(d.expression.callee) === 'Controller')
    if (ctrl) {
      const a = ctrl.expression.arguments[0]
      const prefix = strOf(a) ?? strOf(objProp(a, 'path')) ?? ''
      for (const m of node.body.body) {
        if (m.type !== 'ClassMethod' || !m.decorators) continue
        for (const d of m.decorators) {
          if (d.expression.type !== 'CallExpression') continue
          const dn = calleeText(d.expression.callee)
          if (/^(Get|Post|Put|Patch|Delete|All|Head|Options)$/.test(dn)) {
            const sub = strOf(d.expression.arguments[0]) ?? ''
            const full = '/' + [prefix, sub].filter(Boolean).join('/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')
            out.routes.push({ method: dn.toUpperCase(), path: full, line: lineOf(m), recv: name, framework: 'nest', handler: { method: `${name}.${m.key.name}` } })
          }
        }
      }
    }
    if (decos.length) out.decoratedClasses.push({ name, decorators: decos.map((d) => calleeText(d.expression.type === 'CallExpression' ? d.expression.callee : d.expression)) })
    return name
  }

  // ---------- traversal ----------
  for (const st of ast.program.body) handleTopImport(st)

  function walk(node) {
    if (!node || typeof node.type !== 'string') return
    const parent = ancestors[ancestors.length - 1]
    const gp = ancestors[ancestors.length - 2]
    let pushedFn = false
    let pushedClass = false

    switch (node.type) {
      case 'ImportDeclaration':
        return // handled up-front
      case 'ImportExpression':
        if (node.source?.type === 'StringLiteral' && !(parent?.type === 'VariableDeclarator' || (parent?.type === 'AwaitExpression' && gp?.type === 'VariableDeclarator'))) onImport(node.source.value, [], node, 'dynamic')
        break
      case 'CallExpression':
      case 'OptionalCallExpression':
      case 'NewExpression':
        if (node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') onImport(node.arguments[0].value, [], node, 'dynamic')
        else onCall(node)
        break
      case 'ObjectExpression': {
        // record-shaped objects that a function returns, pushes or sends tell us what data it produces
        if (cur().qual !== '<module>' && parent && (parent.type === 'ReturnStatement' || parent.type === 'ArrowFunctionExpression' || parent.type === 'ArrayExpression' ||
          ((parent.type === 'CallExpression' || parent.type === 'OptionalCallExpression') && /(^|\.)(push|unshift|json|send|append|insert|insertOne|insertMany|create|add|set|write|emit|update|upsert)$/.test(calleeText(parent.callee))))) {
          const keys = node.properties.filter((p) => (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && !p.computed).map((p) => p.key.name ?? p.key.value).filter((k) => typeof k === 'string')
          const CONFIG = /^(method|headers|body|credentials|mode|signal|cache|redirect|timeout|params|baseURL|style|className|onClick|children|key|ref|encoding|flag|recursive|status|ok|error|message|data|type|value|label|loading)$/
          if (keys.length >= 2 && keys.filter((k) => CONFIG.test(k)).length / keys.length < 0.5) {
            const list = (out.fields[cur().qual] ||= [])
            for (const k of keys) if (!list.includes(k) && list.length < 30) list.push(k)
          }
        }
        // route tables: { method: 'PUT', pattern: /^\/courses\/(\d+)\/cover$/, handle }
        const mv = strOf(objProp(node, 'method'))
        if (mv && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL|ANY)$/i.test(mv)) {
          const pNode = objProp(node, 'path') ?? objProp(node, 'pattern') ?? objProp(node, 'route') ?? objProp(node, 'url')
          const p = pNode ? (pNode.type === 'RegExpLiteral' ? regexToPath(pNode.pattern) : strOf(pNode)) : null
          const h = ['handle', 'handler', 'fn', 'action', 'resolve', 'callback', 'controller', 'run'].map((k) => objProp(node, k)).find(Boolean)
          if (p != null && h && (p.startsWith('/') || p.startsWith('${'))) addRoute(node, mv.toUpperCase(), p, [h], 'table', 'custom')
        }
        break
      }
      case 'TaggedTemplateExpression': {
        const tag = calleeText(node.tag)
        if (/(^|\.)sql$/.test(tag)) {
          const s = node.quasi.quasis.map((q) => q.value.cooked).join('?')
          const info = sqlInfo(s)
          for (const t of info?.tables?.length ? info.tables : [null]) addOp({ cat: 'db', verb: info?.verb || 'SQL', line: lineOf(node), lib: 'sql``', target: t || shortSel(s), label: `${info?.verb || 'SQL'} ${t ?? ''}`.trim() + ' (SQL)', rw: info ? sqlVerbKind(info.verb) : 'read', sql: s.slice(0, 400), resource: dbResource(t, [...pkgs].map((p) => DB_PKGS[p]).find(Boolean)) })
        }
        break
      }
      case 'MemberExpression': {
        const t = calleeText(node.object)
        if (t === 'process.env' || t === 'import.meta.env') {
          const nm = node.computed ? (node.property.type === 'StringLiteral' ? node.property.value : null) : node.property.name
          if (nm) out.env.push({ name: nm, line: lineOf(node) })
        }
        break
      }
      case 'VariableDeclarator':
        onDeclarator(node)
        break
      case 'AssignmentExpression':
        onAssign(node)
        break
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportAllDeclaration':
        onExport(node)
        break
      case 'ClassDeclaration':
      case 'ClassExpression':
        classStack.push(onClass(node))
        pushedClass = true
        break
      case 'JSXOpeningElement': {
        const n = node.name
        if (n.type === 'JSXIdentifier' && /^[A-Z]/.test(n.name)) out.calls.push({ fn: cur().qual, name: n.name, recv: null, text: n.name, line: lineOf(node), jsx: true })
        else if (n.type === 'JSXMemberExpression') out.calls.push({ fn: cur().qual, name: n.property.name, recv: n.object.name, text: `${n.object.name}.${n.property.name}`, line: lineOf(node), jsx: true })
        if (n.type === 'JSXIdentifier' && n.name === 'form') {
          const attr = (k) => node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === k)?.value
          const action = attr('action')
          if (action?.type === 'StringLiteral' && action.value.startsWith('/')) addHttp(node, { method: (attr('method')?.value || 'GET'), url: action.value, lib: 'form' })
        }
        break
      }
    }

    if (FN_TYPES.has(node.type)) {
      const mark = handlerMarks.get(node)
      // Named functions are their own unit when they sit at module level, even inside an
      // anonymous module-level callback (DOMContentLoaded, IIFEs). Helpers nested inside
      // another named function are folded into it.
      const atTop = cur().qual === '<module>'
      let name = fnName(node, parent, gp)
      let qual = null
      let kind = 'function'
      const className = classStack[classStack.length - 1]
      const inClassBody = parent?.type === 'ClassBody' || (parent && /^Class(Private)?Property$|^PropertyDefinition$/.test(parent.type))
      if (mark) {
        qual = mark
        kind = 'handler'
      } else if (name && atTop) {
        if (inClassBody && className) { qual = `${className}.${name}`; kind = name === 'constructor' ? 'constructor' : 'method' }
        else if (parent?.type === 'ObjectProperty' || node.type === 'ObjectMethod') {
          const objNode = node.type === 'ObjectMethod' ? parent : gp
          const owner = objectOwner(objNode, node.type === 'ObjectMethod' ? gp : ancestors[ancestors.length - 3])
          if (owner === null) name = null
          else qual = owner ? `${owner}.${name}` : name
          kind = 'method'
        } else qual = name
      }
      if (qual) {
        const isJsxFile = /\.(jsx|tsx)$/.test(file) || opts.jsx
        if (kind === 'function' && /^[A-Z]/.test(name || '') && isJsxFile) kind = 'component'
        else if (kind === 'function' && /^use[A-Z]/.test(name || '')) kind = 'hook'
        out.functions.push({
          name: name || qual, qual, kind, className: inClassBody ? className : undefined,
          line: lineOf(node), endLine: node.loc.end.line, async: !!node.async, generator: !!node.generator,
          params: (node.params || []).map(paramInfo), doc: docFor(node),
        })
        fnStack.push({ qual, depth: 1, pc: paramDefaults(node, null) })
        pushedFn = true
      } else if (!atTop || !name) {
        // anonymous callback or nested helper: attribute to enclosing function
        fnStack.push({ qual: cur().qual, depth: cur().depth + 1, pc: paramDefaults(node, cur().pc) })
        pushedFn = true
      }
    }

    ancestors.push(node)
    for (const key of Object.keys(node)) {
      if (SKIP.has(key)) continue
      const v = node[key]
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === 'string') walk(c)
      } else if (v && typeof v.type === 'string') walk(v)
    }
    ancestors.pop()
    if (pushedFn) fnStack.pop()
    if (pushedClass) classStack.pop()
  }

  walk(ast.program)

  // exported flags
  const exportedLocals = new Map(out.exports.filter((e) => e.local).map((e) => [e.local, e.name]))
  for (const f of out.functions) {
    if (exportedLocals.has(f.qual)) f.exported = exportedLocals.get(f.qual)
    else if (f.qual === 'default' && out.exports.some((e) => e.name === 'default')) f.exported = 'default'
    else if (f.kind === 'method' && f.className && exportedLocals.has(f.className)) f.exported = `${exportedLocals.get(f.className)}#`
    else if (f.kind === 'method' && f.qual.includes('.') && exportedLocals.has(f.qual.split('.')[0])) f.exported = `${exportedLocals.get(f.qual.split('.')[0])}#`
  }
  out.pkgs = [...pkgs]
  out.varKinds = Object.fromEntries([...varKinds].filter(([, v]) => v === 'router' || v === 'client'))
  return out
}

/** Pull <script> blocks out of HTML/Vue/Svelte, padding so line numbers still match. */
export function scriptBlocks(code) {
  const blocks = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(code))) {
    const attrs = m[1]
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]
    if (type && !/javascript|module|babel|jsx|ts/i.test(type)) continue
    const before = code.slice(0, m.index + m[0].indexOf('>') + 1)
    const pad = '\n'.repeat(before.split('\n').length - 1)
    blocks.push({ src, lang: /\blang\s*=\s*["']ts/i.test(attrs) ? 'ts' : 'js', code: pad + m[2] })
  }
  return blocks
}

/** Extract an HTML file: script/style references, inline scripts and forms. */
export function extractHtml(code, file) {
  const out = { imports: [], exports: [], functions: [], calls: [], http: [], routes: [], mounts: [], ops: [], consts: {}, env: [], ports: [], errors: [], pkgs: [] }
  const total = code.split('\n').length
  out.functions.push({ name: '<module>', qual: '<module>', line: 1, endLine: total, kind: 'module', params: [] })
  const lineAt = (i) => code.slice(0, i).split('\n').length
  for (const m of code.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^(https?:)?\/\//.test(m[1])) out.imports.push({ source: m[1], names: [], line: lineAt(m.index), kind: 'html' })
    else out.pkgs.push(m[1])
  }
  for (const m of code.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+\.css)["']/gi)) {
    if (!/^(https?:)?\/\//.test(m[1])) out.imports.push({ source: m[1], names: [], line: lineAt(m.index), kind: 'html' })
  }
  for (const m of code.matchAll(/<form\b([^>]*)>/gi)) {
    const action = m[1].match(/\baction\s*=\s*["']([^"']+)["']/i)?.[1]
    const method = m[1].match(/\bmethod\s*=\s*["']([^"']+)["']/i)?.[1] || 'GET'
    if (action && !action.startsWith('#')) {
      const parsed = parseUrl(action)
      out.http.push({ fn: '<module>', line: lineAt(m.index), method: method.toUpperCase(), url: action, lib: 'form', parsed })
      out.ops.push({ fn: '<module>', cat: 'http', verb: method.toUpperCase(), line: lineAt(m.index), lib: 'form', target: action, label: `Form submits ${method.toUpperCase()} ${action}`, resource: parsed.kind === 'external' ? hostResource(parsed.host) : null, httpIndex: out.http.length - 1 })
    }
  }
  for (const b of scriptBlocks(code)) {
    if (b.src || !b.code.trim()) continue
    const sub = extractJs(b.code, file.replace(/\.html?$/, b.lang === 'ts' ? '.ts' : '.js'), { frontend: true })
    mergeInto(out, sub)
  }
  return out
}

export function mergeInto(out, sub) {
  out.fields = { ...(out.fields || {}), ...(sub.fields || {}) }
  const httpBase = out.http.length
  for (const k of ['imports', 'exports', 'calls', 'http', 'routes', 'mounts', 'env', 'ports', 'errors']) out[k].push(...(sub[k] || []))
  out.ops.push(...(sub.ops || []).map((o) => (o.httpIndex != null ? { ...o, httpIndex: o.httpIndex + httpBase } : o)))
  out.functions.push(...sub.functions.filter((f) => f.qual !== '<module>'))
  Object.assign(out.consts, sub.consts)
  out.pkgs = [...new Set([...(out.pkgs || []), ...(sub.pkgs || [])])]
}
