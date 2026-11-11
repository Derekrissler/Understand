// Cross-file resolution: imports -> project files, local names -> definitions,
// and call sites -> the functions they invoke.
import path from 'node:path'
import { pkgOf } from './js.js'

const P = path.posix
const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.css', '.scss']

/** Strip comments and trailing commas from JSONC (tsconfig) without touching strings. */
export function parseJsonc(text) {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') { out += text[++i] ?? ''; continue }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue }
    out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

export class Resolver {
  constructor(files, texts) {
    this.fileSet = new Set(files.map((f) => f.path))
    this.files = files
    this.aliases = [] // { dir, prefix, targets: [dir-relative paths], wildcard }
    this.loadAliases(texts)
    // python: module dotted path -> file
    this.pyFiles = files.filter((f) => f.lang === 'python' || f.lang === 'notebook').map((f) => f.path)
  }

  loadAliases(texts) {
    for (const f of this.files) {
      const base = P.basename(f.path)
      const dir = P.dirname(f.path) === '.' ? '' : P.dirname(f.path)
      if (/^(tsconfig|jsconfig)(\.\w+)?\.json$/.test(base)) {
        try {
          const cfg = parseJsonc(texts.get(f.path) || '{}')
          const co = cfg.compilerOptions || {}
          const baseUrl = P.join(dir, co.baseUrl || '.')
          for (const [k, vals] of Object.entries(co.paths || {})) {
            this.aliases.push({ dir, prefix: k.replace(/\*$/, ''), wildcard: k.endsWith('*'), targets: vals.map((v) => P.normalize(P.join(baseUrl, v.replace(/\*$/, '')))) })
          }
          if (co.baseUrl) this.aliases.push({ dir, prefix: '', wildcard: true, targets: [P.normalize(baseUrl)], baseUrl: true })
        } catch {}
      }
      if (/^vite\.config\.[mc]?[jt]s$|^vue\.config\.js$|^svelte\.config\.js$|^astro\.config/.test(base)) {
        const t = texts.get(f.path) || ''
        for (const m of t.matchAll(/['"]?(@[\w-]*|~|#\w+)['"]?\s*:\s*(?:path\.resolve\(\s*__dirname\s*,\s*|fileURLToPath\(\s*new URL\(\s*|resolve\(\s*__dirname\s*,\s*)?['"]\.?\/?([^'"]+?)\/?['"]/g)) {
          this.aliases.push({ dir, prefix: m[1] + '/', wildcard: true, targets: [P.normalize(P.join(dir, m[2])) + '/'] })
          this.aliases.push({ dir, prefix: m[1], wildcard: false, targets: [P.normalize(P.join(dir, m[2]))] })
        }
      }
    }
    // longest prefixes first, closest configs first
    this.aliases.sort((a, b) => b.prefix.length - a.prefix.length || b.dir.length - a.dir.length)
  }

  tryJs(base) {
    if (this.fileSet.has(base)) return base
    const noExt = base.replace(/\.(m|c)?jsx?$/, '')
    if (noExt !== base) for (const e of JS_EXTS) if (this.fileSet.has(noExt + e)) return noExt + e
    for (const e of JS_EXTS) if (this.fileSet.has(base + e)) return base + e
    for (const e of JS_EXTS) if (this.fileSet.has(`${base}/index${e}`)) return `${base}/index${e}`
    return null
  }

  resolveJs(from, spec) {
    if (!spec) return null
    spec = spec.split('?')[0]
    const dir = P.dirname(from)
    if (spec.startsWith('.')) return this.tryJs(P.normalize(P.join(dir, spec)))
    if (spec.startsWith('/')) return this.resolveWebPath(from, spec)
    for (const a of this.aliases) {
      if (a.dir && !from.startsWith(a.dir + '/')) continue
      if (a.baseUrl) {
        const r = this.tryJs(P.normalize(P.join(a.targets[0], spec)))
        if (r) return r
        continue
      }
      if (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix) {
        for (const t of a.targets) {
          const r = this.tryJs(P.normalize(a.wildcard ? P.join(t, spec.slice(a.prefix.length)) : t))
          if (r) return r
        }
      }
    }
    if (/^[@~#]\//.test(spec)) {
      // common default: @/ -> src/ near the importing file
      let d = dir
      while (true) {
        const r = this.tryJs(P.normalize(P.join(d === '.' ? '' : d, 'src', spec.slice(2)))) || this.tryJs(P.normalize(P.join(d === '.' ? '' : d, spec.slice(2))))
        if (r) return r
        if (d === '.' || d === '') break
        d = P.dirname(d)
      }
    }
    return null
  }

  /** "/js/app.js" from an HTML page or static server: try web roots near the file, then suffix match. */
  resolveWebPath(from, spec) {
    const rel = spec.replace(/^\/+/, '')
    let d = P.dirname(from)
    while (true) {
      const base = d === '.' ? '' : d
      for (const root of ['', 'public', 'static', 'src/main/resources/static', 'resources/static', 'www', 'dist']) {
        const r = this.tryJs(P.normalize(P.join(base, root, rel)))
        if (r) return r
      }
      if (d === '.' || d === '') break
      d = P.dirname(d)
    }
    const cands = this.files.filter((f) => f.path.endsWith('/' + rel) || f.path === rel)
    if (!cands.length) return null
    const common = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
    cands.sort((a, b) => common(b.path, from) - common(a.path, from))
    return cands[0].path
  }

  pyModuleFile(base) {
    const b = base.replace(/^\/+/, '')
    if (this.fileSet.has(b + '.py')) return b + '.py'
    if (this.fileSet.has(b + '/__init__.py')) return b + '/__init__.py'
    if (this.fileSet.has(b + '.ipynb')) return null
    return null
  }

  pyIsPackageDir(base) {
    const pre = base.replace(/^\/+/, '') + '/'
    return this.pyFiles.some((p) => p.startsWith(pre))
  }

  /** Resolve a Python import. Returns { file, base, names: { name -> file } } or null when external. */
  resolvePy(from, module, level) {
    const modPath = (module || '').replace(/\./g, '/')
    const bases = []
    if (level > 0) {
      let d = P.dirname(from)
      for (let i = 1; i < level; i++) d = P.dirname(d)
      bases.push(P.normalize(P.join(d === '.' ? '' : d, modPath)))
    } else {
      let d = P.dirname(from)
      const roots = []
      while (true) {
        roots.push(d === '.' ? '' : d)
        if (d === '.' || d === '') break
        d = P.dirname(d)
      }
      roots.push('src')
      for (const r of roots) bases.push(P.normalize(P.join(r, modPath)))
    }
    for (const b of bases) {
      const clean = b === '.' ? '' : b
      const file = clean ? this.pyModuleFile(clean) : this.fileSet.has('__init__.py') ? '__init__.py' : null
      if (file || (clean && this.pyIsPackageDir(clean)) || (level > 0)) return { file, base: clean }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Bindings and call resolution

/**
 * Build a per-file binding table (local name -> definition in another project file)
 * and the list of resolved import edges.
 */
export function buildBindings(fileFacts, resolver, javaIndex) {
  const bindings = new Map() // file -> Map(local -> { file, imported, module })
  const edges = new Map() // file -> Set(target files)
  const addEdge = (a, b) => {
    if (!b || a === b) return
    if (!edges.has(a)) edges.set(a, new Set())
    edges.get(a).add(b)
  }
  for (const [file, facts] of fileFacts) {
    const b = new Map()
    bindings.set(file, b)
    if (facts.lang === 'python') {
      for (const imp of facts.imports) {
        const r = resolver.resolvePy(file, imp.module, imp.level)
        if (!r) continue
        imp.resolved = r.file
        addEdge(file, r.file)
        if (!imp.names) {
          const local = imp.alias || imp.module.split('.')[0]
          if (imp.alias) b.set(local, { file: r.file, module: true })
          else {
            // `import a.b` binds `a`; remember the full dotted module too
            const top = resolver.resolvePy(file, imp.module.split('.')[0], 0)
            b.set(local, { file: top?.file ?? null, module: true, dotted: { [imp.module]: r.file } })
          }
        } else {
          for (const nm of imp.names) {
            const local = nm.alias || nm.name
            const sub = r.base !== undefined ? resolver.pyModuleFile(P.join(r.base, nm.name)) : null
            if (sub) {
              b.set(local, { file: sub, module: true })
              addEdge(file, sub)
            } else if (r.file) b.set(local, { file: r.file, imported: nm.name })
          }
        }
      }
    } else if (facts.lang === 'java') {
      const pkg = facts.package
      const seen = new Set()
      for (const imp of facts.imports) {
        if (imp.static) continue
        if (imp.wildcard) {
          const p = imp.source.replace(/\.\*$/, '')
          for (const [fq, f] of javaIndex.byFq) if (fq.startsWith(p + '.') && !fq.slice(p.length + 1).includes('.')) { b.set(fq.split('.').pop(), { file: f, java: true }); seen.add(fq.split('.').pop()) }
        } else {
          const f = javaIndex.byFq.get(imp.source)
          if (f) { b.set(imp.source.split('.').pop(), { file: f, java: true }); imp.resolved = f; seen.add(imp.source.split('.').pop()) }
        }
      }
      // same-package classes need no import
      for (const ref of facts.typeRefs || []) {
        if (seen.has(ref)) continue
        const f = javaIndex.byFq.get(pkg ? `${pkg}.${ref}` : ref)
        if (f && f !== file) b.set(ref, { file: f, java: true })
      }
      for (const ref of facts.typeRefs || []) { const t = b.get(ref); if (t) addEdge(file, t.file) }
    } else {
      for (const imp of facts.imports) {
        const r = imp.kind === 'html' ? resolver.resolveWebPath(file, imp.source.startsWith('/') ? imp.source : '/' + P.normalize(P.join(P.dirname(file), imp.source))) || resolver.resolveJs(file, imp.source.startsWith('.') || imp.source.startsWith('/') ? imp.source : './' + imp.source) : resolver.resolveJs(file, imp.source)
        imp.resolved = r
        imp.pkg = r ? null : pkgOf(imp.source)
        if (!r) continue
        if (!imp.typeOnly) addEdge(file, r)
        for (const nm of imp.names || []) b.set(nm.local, { file: r, imported: nm.imported })
      }
    }
  }
  return { bindings, edges }
}

export function buildJavaIndex(fileFacts) {
  const byFq = new Map()
  const bySimple = new Map()
  const classInfo = new Map() // simple name -> [{ file, info }]
  const implementors = new Map()
  for (const [file, facts] of fileFacts) {
    if (facts.lang !== 'java') continue
    for (const c of facts.classes || []) {
      const fq = facts.package ? `${facts.package}.${c.name}` : c.name
      byFq.set(fq, file)
      if (!bySimple.has(c.name)) bySimple.set(c.name, [])
      bySimple.get(c.name).push(file)
      if (!classInfo.has(c.name)) classInfo.set(c.name, [])
      classInfo.get(c.name).push({ file, info: c })
      for (const i of (c.implements || '').split(',').map((s) => s.replace(/<.*$/, '').trim().split('.').pop()).filter(Boolean)) {
        if (!implementors.has(i)) implementors.set(i, [])
        implementors.get(i).push({ file, name: c.name })
      }
    }
  }
  return { byFq, bySimple, classInfo, implementors }
}

/** Index functions by file for fast lookup. */
export function indexFunctions(functions) {
  const byFile = new Map()
  for (const f of functions) {
    if (!byFile.has(f.file)) byFile.set(f.file, { byQual: new Map(), byName: new Map() })
    const ix = byFile.get(f.file)
    ix.byQual.set(f.qual, f)
    if (!ix.byName.has(f.name)) ix.byName.set(f.name, [])
    ix.byName.get(f.name).push(f)
  }
  return byFile
}

export function resolveCalls({ fileFacts, functions, bindings, javaIndex }) {
  const fnIx = indexFunctions(functions)
  const fnById = new Map(functions.map((f) => [f.id, f]))
  const exportsOf = new Map([...fileFacts].map(([file, facts]) => [file, facts.exports || []]))

  const lookupExport = (file, name, depth = 0) => {
    const ix = fnIx.get(file)
    if (!ix || depth > 4) return null
    for (const e of exportsOf.get(file) || []) {
      if (e.name === name && e.local && ix.byQual.has(e.local)) return ix.byQual.get(e.local)
      if (e.name === name && e.from) {
        const t = fileFacts.get(file)?.imports.find((i) => i.source === e.from)?.resolved
        if (t) { const r = lookupExport(t, e.imported || name, depth + 1); if (r) return r }
      }
    }
    if (ix.byQual.has(name)) return ix.byQual.get(name)
    for (const e of exportsOf.get(file) || []) {
      if (e.name === '*' && e.from) {
        const t = fileFacts.get(file)?.imports.find((i) => i.source === e.from)?.resolved
        if (t) { const r = lookupExport(t, name, depth + 1); if (r) return r }
      }
    }
    return null
  }
  const defaultLocal = (file) => (exportsOf.get(file) || []).find((e) => e.name === 'default')?.local

  const resolveOne = (file, facts, call, fromFn) => {
    const ix = fnIx.get(file)
    const b = bindings.get(file) || new Map()
    const lang = facts.lang
    if (lang === 'java') {
      const types = []
      if (call.recvType) types.push(call.recvType)
      if (!call.recv && fromFn?.className) types.push(fromFn.className)
      for (const T of types) {
        const files = (b.get(T)?.file ? [b.get(T).file] : []).concat(T === fromFn?.className ? [file] : []).concat(javaIndex.bySimple.get(T) || [])
        for (const f of [...new Set(files)]) {
          const hit = fnIx.get(f)?.byQual.get(`${T}.${call.name}`)
          if (hit) return [hit]
        }
        const impls = javaIndex.implementors.get(T) || []
        const out = []
        for (const im of impls) { const hit = fnIx.get(im.file)?.byQual.get(`${im.name}.${call.name}`); if (hit) out.push(hit) }
        if (out.length) return out
        for (const f of javaIndex.bySimple.get(T) || []) { const repo = fnIx.get(f)?.byQual.get(T); if (repo?.kind === 'repository') return [repo] }
      }
      return []
    }
    if (lang === 'python') {
      if (!call.recv) {
        const local = ix?.byQual.get(call.name) || ix?.byQual.get(`${call.name}.__init__`)
        if (local && local.qual !== fromFn?.qual) return [local]
        const bd = b.get(call.name)
        if (bd?.file && !bd.module) {
          const t = fnIx.get(bd.file)
          const hit = t?.byQual.get(bd.imported) || t?.byQual.get(`${bd.imported}.__init__`)
          return hit ? [hit] : []
        }
        return []
      }
      const segs = call.text.split('.')
      if ((call.recv === 'self' || call.recv === 'cls') && segs.length === 2 && fromFn?.className) {
        const hit = ix?.byQual.get(`${fromFn.className}.${call.name}`)
        return hit ? [hit] : []
      }
      const bd = b.get(call.recv)
      if (bd?.module) {
        if (segs.length > 2 && bd.dotted) {
          const modFile = bd.dotted[segs.slice(0, -1).join('.')]
          const hit = modFile && fnIx.get(modFile)?.byQual.get(call.name)
          if (hit) return [hit]
        }
        const hit = segs.length === 2 && bd.file ? fnIx.get(bd.file)?.byQual.get(call.name) : null
        return hit ? [hit] : []
      }
      if (bd?.file && segs.length === 2) {
        const hit = fnIx.get(bd.file)?.byQual.get(`${bd.imported}.${call.name}`)
        return hit ? [hit] : []
      }
      if (segs.length === 2) {
        const hit = ix?.byQual.get(`${call.recv}.${call.name}`)
        return hit ? [hit] : []
      }
      return []
    }
    // JS / TS
    if (!call.recv) {
      const local = ix?.byQual.get(call.name)
      if (local && local.qual !== fromFn?.qual) return [local]
      const bd = b.get(call.name)
      if (bd?.file) {
        const hit = lookupExport(bd.file, bd.imported === '*' ? 'default' : bd.imported) || (bd.imported === 'default' ? fnIx.get(bd.file)?.byQual.get(defaultLocal(bd.file)) : null)
        return hit ? [hit] : []
      }
      return []
    }
    if (call.recv === 'this' || call.recv === 'super') {
      if (!fromFn?.className) return []
      const hit = ix?.byQual.get(`${fromFn.className}.${call.name}`)
      return hit ? [hit] : []
    }
    const segs = call.text.replace(/^new /, '').split('.')
    const bd = b.get(call.recv)
    if (bd?.file && segs.length === 2) {
      const t = fnIx.get(bd.file)
      const owner = bd.imported === 'default' ? defaultLocal(bd.file) : bd.imported
      const hit = (owner && owner !== '*' && t?.byQual.get(`${owner}.${call.name}`)) || lookupExport(bd.file, call.name) || t?.byQual.get(call.name)
      return hit ? [hit] : []
    }
    if (segs.length === 2) {
      const hit = ix?.byQual.get(`${call.recv}.${call.name}`)
      return hit ? [hit] : []
    }
    return []
  }

  const callEdges = new Map() // fnId -> [{ to, line }]
  for (const [file, facts] of fileFacts) {
    const ix = fnIx.get(file)
    for (const call of facts.calls || []) {
      const fromFn = ix?.byQual.get(call.fn) || ix?.byQual.get('<module>')
      if (!fromFn) continue
      for (const target of resolveOne(file, facts, call, fromFn)) {
        if (target.id === fromFn.id) continue
        if (!callEdges.has(fromFn.id)) callEdges.set(fromFn.id, [])
        const list = callEdges.get(fromFn.id)
        if (!list.some((e) => e.to === target.id && e.line === call.line)) list.push({ to: target.id, line: call.line, jsx: !!call.jsx, args: call.args, argText: call.argText, recv: call.recv })
      }
    }
  }
  for (const f of functions) {
    f.callees = [...new Set((callEdges.get(f.id) || []).map((e) => e.to))]
    f.callers = []
  }
  for (const f of functions) for (const t of f.callees) fnById.get(t)?.callers.push(f.id)
  return { callEdges, fnIx, lookupExport, defaultLocal }
}
