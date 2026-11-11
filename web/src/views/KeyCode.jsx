import { useMemo, useState } from 'react'
import { useProject } from '../context.js'
import { CodeBlock } from '../components/CodeBlock.jsx'
import { CatChip, Method } from '../components/ui.jsx'
import { CAT_COLORS, fnLabel, plural } from '../lib/format.js'
import { IconPlay, IconTrace, IconSearch } from '../lib/icons.jsx'

const ORDER = ['scrape', 'http', 'db', 'llm', 'file', 'transform', 'dom', 'storage', 'auth', 'email', 'payments', 'realtime', 'process', 'jobs']

export function KeyCode() {
  const { model, id, params, go, fnById, routeById, openTrace, testFn } = useProject()
  const cat = params.cat || 'all'
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(20)
  const [hideTests, setHideTests] = useState(true)

  const roleOf = useMemo(() => new Map(model.files.map((f) => [f.path, f.role])), [model])
  const counts = useMemo(() => {
    const c = {}
    for (const o of model.ops) if (!hideTests || roleOf.get(o.file) !== 'test') c[o.cat] = (c[o.cat] || 0) + 1
    return c
  }, [model, hideTests, roleOf])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const m = new Map()
    for (const o of model.ops) {
      if (cat !== 'all' && o.cat !== cat) continue
      if (hideTests && roleOf.get(o.file) === 'test') continue
      if (q && !`${o.label} ${o.file} ${o.target}`.toLowerCase().includes(q) && !(o.fnId && fnById.get(o.fnId)?.qual.toLowerCase().includes(q))) continue
      const key = o.fnId || `${o.file}#?`
      if (!m.has(key)) m.set(key, { key, fn: o.fnId ? fnById.get(o.fnId) : null, file: o.file, ops: [] })
      m.get(key).ops.push(o)
    }
    const list = [...m.values()]
    const score = (g) => new Set(g.ops.map((o) => o.cat)).size * 10 + g.ops.length + (g.fn?.routeIds.length ? 5 : 0)
    list.sort((a, b) => score(b) - score(a) || a.file.localeCompare(b.file))
    return list
  }, [model, cat, query, fnById, hideTests, roleOf])

  const cats = ORDER.filter((c) => counts[c]).concat(Object.keys(counts).filter((c) => !ORDER.includes(c)))

  return (
    <div className="split">
      <div className="left">
        <div style={{ padding: '16px 14px 8px' }}>
          <h2>Key code</h2>
          <p className="muted small" style={{ marginTop: 4 }}>Every line that moves data in or out of the program, grouped by the function it lives in.</p>
        </div>
        <div className="list">
          <div className={`list-item${cat === 'all' ? ' on' : ''}`} onClick={() => { go('code', {}); setLimit(20) }}>
            <span className="grow">All operations</span><span className="faint small">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
          </div>
          {cats.map((c) => (
            <div key={c} className={`list-item${cat === c ? ' on' : ''}`} onClick={() => { go('code', { cat: c }); setLimit(20) }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: CAT_COLORS[c] }} />
              <div className="grow">
                <div>{model.categories[c]?.label || c}</div>
                <div className="faint small ellipsis">{model.categories[c]?.blurb}</div>
              </div>
              <span className="faint small">{counts[c]}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 12 }}>
          <label className="check"><input type="checkbox" checked={hideTests} onChange={(e) => setHideTests(e.target.checked)} /> Hide test files</label>
        </div>
      </div>
      <div className="right">
        <div className="page-inner" style={{ maxWidth: 1000 }}>
          <div className="spread">
            <div>
              <h1>{cat === 'all' ? 'All operations' : model.categories[cat]?.label}</h1>
              <div className="muted small">{plural(groups.length, 'function')} · {plural(groups.reduce((s, g) => s + g.ops.length, 0), 'operation')}</div>
            </div>
            <div className="row" style={{ position: 'relative' }}>
              <IconSearch size={14} style={{ position: 'absolute', left: 9, color: 'var(--faint)' }} />
              <input style={{ paddingLeft: 28, width: 260 }} placeholder="Filter by table, URL, selector, file…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          {groups.length === 0 && <div className="card empty">Nothing in this category.</div>}
          {groups.slice(0, limit).map((g) => (
            <div key={g.key} className="card">
              <div className="card-pad col" style={{ gap: 8, paddingBottom: 12 }}>
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <code style={{ fontWeight: 650, fontSize: 13.5 }}>{g.fn ? fnLabel(g.fn) : g.file}</code>
                      {g.fn?.kind && !['function', 'module'].includes(g.fn.kind) && <span className="chip">{g.fn.kind}</span>}
                      {g.fn?.routeIds.map((rid) => {
                        const r = routeById.get(rid)
                        return r ? <span key={rid} className="chip click mono" onClick={() => openTrace(`route:${rid}`)}><Method m={r.method} />{r.path}</span> : null
                      })}
                    </div>
                    <div className="faint small mono">{g.file}{g.fn ? `:${g.fn.line}` : ''}</div>
                    {g.fn?.doc && <div className="muted small" style={{ marginTop: 2 }}>{g.fn.doc}</div>}
                  </div>
                  <div className="row" style={{ flex: 'none' }}>
                    {g.fn?.runnable?.ok && <button className="small" onClick={() => testFn(g.fn.id)}><IconPlay size={12} /> Run</button>}
                    {g.fn && <button className="small" onClick={() => openTrace(`fn:${g.fn.id}`)}><IconTrace size={13} /> Trace</button>}
                  </div>
                </div>
                <div className="col" style={{ gap: 3 }}>
                  {g.ops.slice(0, 8).map((o) => (
                    <div key={o.id} className="row small" style={{ gap: 8 }}>
                      <CatChip cat={o.cat} />
                      <span className="ellipsis">{o.label}</span>
                      <span className="faint mono">L{o.line}</span>
                      {o.sql && <code className="faint ellipsis" title={o.sql} style={{ maxWidth: 320 }}>{o.sql}</code>}
                    </div>
                  ))}
                  {g.ops.length > 8 && <span className="faint small">+{g.ops.length - 8} more</span>}
                </div>
              </div>
              <div style={{ padding: '0 12px 12px' }}>
                <CodeBlock
                  projectId={id}
                  path={g.file}
                  start={g.fn && g.fn.qual !== '<module>' ? g.fn.line : Math.max(1, Math.min(...g.ops.map((o) => o.line)) - 3)}
                  end={g.fn && g.fn.qual !== '<module>' ? g.fn.endLine : Math.max(...g.ops.map((o) => o.line)) + 3}
                  ops={g.ops.map((o) => ({ line: o.line, label: o.label, cat: o.cat }))}
                  context={2}
                />
              </div>
            </div>
          ))}
          {groups.length > limit && <button onClick={() => setLimit((l) => l + 20)} style={{ alignSelf: 'center' }}>Show {Math.min(20, groups.length - limit)} more</button>}
        </div>
      </div>
    </div>
  )
}
