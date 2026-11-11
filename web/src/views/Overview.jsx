import { useMemo } from 'react'
import { useProject } from '../context.js'
import { Section, CatChip, CopyButton, RoleBadge } from '../components/ui.jsx'
import { fmtNum, basename, fnLabel, RESOURCE_KIND, CAT_COLORS, plural } from '../lib/format.js'

const LANG_COLORS = { typescript: '#3178c6', javascript: '#f1e05a', python: '#3572a5', java: '#b07219', kotlin: '#a97bff', html: '#e34c26', css: '#663399', scss: '#c6538c', vue: '#41b883', svelte: '#ff3e00', go: '#00add8', rust: '#dea584', ruby: '#701516', php: '#4f5d95', swift: '#f05138', csharp: '#178600', c: '#555555', cpp: '#f34b7d', shell: '#89e051', sql: '#e38c00', notebook: '#da5b0b', dart: '#00b4ab' }

export function Overview() {
  const { model, fnById, go, openTrace } = useProject()
  const { stack, totals, health, insights } = model

  const byCat = useMemo(() => {
    const m = new Map()
    for (const t of stack.technologies) {
      if (!t.known) continue
      if (!m.has(t.category)) m.set(t.category, [])
      m.get(t.category).push(t)
    }
    return [...m]
  }, [stack])
  const others = stack.technologies.filter((t) => !t.known)
  const totalLoc = stack.languages.reduce((s, l) => s + l.loc, 0) || 1
  const resources = useMemo(() => {
    const m = new Map()
    for (const r of model.resources) {
      const k = r.kind
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return [...m]
  }, [model])
  const opCats = useMemo(() => {
    const m = {}
    for (const o of model.ops) m[o.cat] = (m[o.cat] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [model])
  const roles = useMemo(() => {
    const m = {}
    for (const f of model.files) if (f.role && !['other'].includes(f.role)) m[f.role] = (m[f.role] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [model])

  const issues = [
    health.counts.unmatchedCalls && { level: 'bad', text: `${plural(health.counts.unmatchedCalls, 'call')} to an API route that doesn't exist` },
    health.counts.secrets && { level: 'bad', text: `${plural(health.counts.secrets, 'possible hardcoded secret')}` },
    health.envFileNotIgnored && { level: 'bad', text: `${health.envFileNotIgnored} is not in .gitignore` },
    health.counts.identicalDuplicates && { level: 'warn', text: `${plural(health.counts.identicalDuplicates, 'function')} copy-pasted between files` },
    health.counts.orphans && { level: 'warn', text: `${plural(health.counts.orphans, 'file')} nothing imports (possibly dead code)` },
    health.counts.unusedDeps && { level: 'warn', text: `${plural(health.counts.unusedDeps, 'dependency', 'dependencies')} declared but never imported` },
    health.counts.undocumentedEnv && { level: 'warn', text: `${plural(health.counts.undocumentedEnv, 'env var')} used but not listed in any .env file` },
    health.counts.parseErrors && { level: 'warn', text: `${plural(health.counts.parseErrors, 'file')} could not be parsed` },
  ].filter(Boolean)

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>{model.name}</h1>
            <p className="mono small">{model.source === 'upload' ? 'Uploaded copy' : model.root}</p>
          </div>
          <div className="row">
            <button onClick={() => go('flow')}>Open the flow map →</button>
          </div>
        </div>

        <div className="stat-grid">
          <Stat v={totals.codeFiles} l="code files" />
          <Stat v={totals.loc} l="lines of code" />
          <Stat v={totals.functions} l="functions" />
          <Stat v={totals.routes} l="API routes" onClick={() => go('flow')} />
          <Stat v={model.http.filter((h) => h.kind !== 'wrapper').length} l="network calls" onClick={() => go('code', { cat: 'http' })} />
          <Stat v={totals.ops} l="data operations" onClick={() => go('code')} />
        </div>
        {model.truncated && <div className="notice warn"><span>⚠</span><span>Very large folder: only the first 20,000 files were analysed.</span></div>}

        {issues.length > 0 && (
          <Section title="Worth a look" hint="Things vibecoded projects tend to hide" actions={<button className="small" onClick={() => go('issues')}>All issues →</button>}>
            <div className="col" style={{ gap: 6 }}>
              {issues.map((i, k) => (
                <div key={k} className="row" style={{ cursor: 'pointer' }} onClick={() => go('issues')}>
                  <span className={`chip ${i.level}`}>{i.level === 'bad' ? 'fix' : 'check'}</span>
                  <span>{i.text}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <div className="two-col">
          <Section title="Stack at a glance" hint="From manifests (package.json, requirements, Gradle…) and from what the code imports">
            {byCat.length === 0 && <div className="muted">No known frameworks detected.</div>}
            <div className="col" style={{ gap: 12 }}>
              {byCat.map(([cat, list]) => (
                <div key={cat}>
                  <div className="section-title" style={{ marginBottom: 6 }}>{cat}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {list.map((t) => (
                      <span key={t.label} className={`chip${t.undeclared ? ' warn' : ''}`} title={`${t.evidence.join('\n')}${t.packages.length ? '\npackages: ' + t.packages.join(', ') : ''}`}>
                        {t.label}
                        {t.versions[0] && <span className="faint">{t.versions[0]}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {others.length > 0 && (
                <details>
                  <summary className="muted small" style={{ cursor: 'pointer' }}>{others.length} other libraries</summary>
                  <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                    {others.map((t) => <span key={t.label} className="chip">{t.label}</span>)}
                  </div>
                </details>
              )}
            </div>
          </Section>

          <div className="col" style={{ gap: 16 }}>
            <Section title="Languages">
              <div className="bar" style={{ height: 10, marginBottom: 12 }}>
                {stack.languages.map((l) => <span key={l.lang} title={`${l.lang}: ${l.loc} lines`} style={{ width: `${(l.loc / totalLoc) * 100}%`, background: LANG_COLORS[l.lang] || '#6b7280' }} />)}
              </div>
              <div className="row wrap" style={{ gap: 14 }}>
                {stack.languages.map((l) => (
                  <span key={l.lang} className="small">
                    <span className="sw" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: LANG_COLORS[l.lang] || '#6b7280', marginRight: 6 }} />
                    {l.lang} <span className="faint">{Math.round((l.loc / totalLoc) * 100)}% · {fmtNum(l.files)} files</span>
                  </span>
                ))}
              </div>
              {roles.length > 0 && (
                <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
                  {roles.map(([r, n]) => <span key={r} className="row" style={{ gap: 4 }}><RoleBadge role={r} /><span className="faint small">{n}</span></span>)}
                </div>
              )}
            </Section>
            <Section title="What the code does" hint="Operations found, by kind">
              <div className="row wrap" style={{ gap: 6 }}>
                {opCats.map(([c, n]) => <CatChip key={c} cat={c} label={`${model.categories[c]?.label || c} ${n}`} onClick={() => go('code', { cat: c })} />)}
                {!opCats.length && <span className="muted">No data operations detected.</span>}
              </div>
            </Section>
          </div>
        </div>

        <Section title="Read these first" hint="Ranked by what they touch (routes, data, network) and how much else depends on them" pad={false}>
          <div className="list">
            {insights.readFirst.slice(0, 12).map((r, i) => {
              const fn = fnById.get(r.fnId)
              if (!fn) return null
              return (
                <div key={r.fnId} className="list-item" onClick={() => openTrace(`fn:${fn.id}`)}>
                  <span className="faint mono" style={{ width: 20, textAlign: 'right' }}>{i + 1}</span>
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <code style={{ fontWeight: 600 }}>{fnLabel(fn)}</code>
                      {fn.routeIds.map((rid) => {
                        const rt = model.routes.find((x) => x.id === rid)
                        return rt ? <span key={rid} className="chip mono"><span className={`method ${rt.method}`}>{rt.method}</span>{rt.path}</span> : null
                      })}
                    </div>
                    <div className="faint small ellipsis">{fn.file}:{fn.line}{fn.doc ? ` · ${fn.doc}` : ''}</div>
                  </div>
                  <span className="muted small" style={{ textAlign: 'right', maxWidth: 320 }}>{r.reasons.join(' · ')}</span>
                </div>
              )
            })}
            {!insights.readFirst.length && <div className="empty">Nothing stood out. Try the Modules view.</div>}
          </div>
        </Section>

        <div className="two-col">
          <Section title="How to run it" hint="Each part of the project and its start commands">
            <div className="col" style={{ gap: 12 }}>
              {stack.parts.map((p, i) => (
                <div key={i} className="col" style={{ gap: 4 }}>
                  <div className="row"><b>{p.name}</b><span className="chip">{p.role}</span><span className="faint small mono">{p.dir}</span></div>
                  {p.run.slice(0, 6).map((r, k) => (
                    <div key={k} className="row" style={{ gap: 6 }}>
                      <code className="ellipsis" style={{ background: 'var(--bg-2)', padding: '2px 8px', borderRadius: 5, border: '1px solid var(--border)' }}>{p.dir !== '.' && !r.cmd.startsWith('python ') && !r.cmd.startsWith('chrome') ? `cd ${p.dir} && ` : ''}{r.cmd}</code>
                      <CopyButton text={(p.dir !== '.' && !r.cmd.startsWith('python ') ? `cd ${p.dir} && ` : '') + r.cmd} />
                      <span className="faint small ellipsis">{r.does}</span>
                    </div>
                  ))}
                </div>
              ))}
              {!stack.parts.length && <span className="muted">No manifests found.</span>}
              {stack.ports.length > 0 && (
                <div className="row wrap small muted" style={{ gap: 6 }}>
                  Ports: {stack.ports.map((p) => <span key={p.port} className="chip mono" title={p.source}>:{p.port} {p.kind}{p.guess ? ' (default)' : ''}</span>)}
                </div>
              )}
            </div>
          </Section>

          <Section title="What it touches" hint="Databases, files, outside APIs and services. Click to see the code involved" pad={false}>
            <div className="list">
              {resources.map(([kind, list]) => list.slice(0, 8).map((r) => (
                <div key={r.key} className="list-item" onClick={() => openTrace(`res:${r.key}`)}>
                  <span className="dot" style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[{ web: 'scrape', dom: 'dom' }[kind] || kind] || 'var(--muted)' }} />
                  <span className="grow ellipsis mono small">{r.label}</span>
                  <span className="faint small">{RESOURCE_KIND[kind] || kind}{r.engine ? ` · ${r.engine}` : ''}</span>
                  <span className="faint small">{r.reads ? `${r.reads}r ` : ''}{r.writes ? `${r.writes}w ` : ''}{plural(r.files.length, 'file')}</span>
                </div>
              )))}
              {!model.resources.length && <div className="empty">No databases, files or outside services detected.</div>}
            </div>
          </Section>
        </div>

        {stack.env.length > 0 && (
          <Section title="Environment variables" hint="Names only. Values from .env files are never read into this app's UI" pad={false}>
            <table className="plain">
              <thead><tr><th>Name</th><th>Used in</th><th>Documented</th></tr></thead>
              <tbody>
                {stack.env.slice(0, 60).map((e) => (
                  <tr key={e.name}>
                    <td><code>{e.name}</code>{e.property && <span className="faint small"> (config property)</span>}</td>
                    <td className="small">{[...new Set(e.uses.map((u) => basename(u.file)))].slice(0, 4).join(', ')}{e.uses.length > 4 ? '…' : ''}</td>
                    <td>{e.documented ? <span className="chip ok">yes</span> : <span className="chip warn">not in any .env file</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>
    </div>
  )
}

function Stat({ v, l, onClick }) {
  return (
    <div className="stat" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="v">{fmtNum(v)}</div>
      <div className="l">{l}</div>
    </div>
  )
}
