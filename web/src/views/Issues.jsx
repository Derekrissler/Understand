import { useProject } from '../context.js'
import { Section, Method } from '../components/ui.jsx'
import { basename, fnLabel, plural } from '../lib/format.js'

export function Issues() {
  const { model, httpById, routeById, fnById, openTrace, openFile } = useProject()
  const h = model.health
  const total = Object.values(h.counts).reduce((a, b) => a + b, 0) + (h.envFileNotIgnored ? 1 : 0)

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Issues</h1>
            <p>Things AI-written projects tend to accumulate: calls to endpoints that were renamed, copy-pasted helpers, dead files, secrets pasted into code. These come from static analysis, so treat them as leads to check.</p>
          </div>
        </div>
        {total === 0 && <div className="card empty">Nothing flagged. Nice.</div>}

        {(h.unmatchedCalls.length > 0 || h.envFileNotIgnored || h.secrets.length > 0) && (
          <div className="two-col">
            {h.unmatchedCalls.length > 0 && (
              <Section title="Calls to routes that don't exist" hint="The code requests these, but no route in the project serves them" pad={false}>
                <div className="list">
                  {h.unmatchedCalls.map((hid) => {
                    const c = httpById.get(hid)
                    if (!c) return null
                    const sug = c.suggestions?.[0] ? routeById.get(c.suggestions[0].routeId) : null
                    return (
                      <div key={hid} className="list-item" onClick={() => openFile(c.file, c.line)}>
                        <Method m={c.method} />
                        <div className="grow" style={{ minWidth: 0 }}>
                          <code className="ellipsis" style={{ display: 'block' }}>{c.resolvedUrl}</code>
                          <div className="faint small">{c.file}:{c.line}{sug ? <> · did it mean <code>{sug.method} {sug.path}</code>? ({c.suggestions[0].reason})</> : ''}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}
            {(h.secrets.length > 0 || h.envFileNotIgnored) && (
              <Section title="Possible secrets in code" hint="Values are masked here. Move real keys to .env and rotate any that were committed" pad={false}>
                <div className="list">
                  {h.envFileNotIgnored && (
                    <div className="list-item" onClick={() => openFile('.gitignore')}><span className="chip bad">.env</span><span className="grow">{h.envFileNotIgnored} exists but .gitignore doesn't exclude it</span></div>
                  )}
                  {h.secrets.map((s, i) => (
                    <div key={i} className="list-item" onClick={() => openFile(s.file, s.line)}>
                      <span className="chip bad">{s.kind}</span>
                      <code className="grow ellipsis">{s.preview}</code>
                      <span className="faint small">{s.file}:{s.line}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {h.duplicates.length > 0 && (
          <Section title="Same function in several files" hint="Identical copies drift apart when only one gets fixed" pad={false}>
            <div className="list">
              {h.duplicates.map((d) => (
                <div key={d.name} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div style={{ width: 200, flex: 'none' }}>
                    <code style={{ fontWeight: 600 }}>{d.name}</code>
                    <div>{d.identical ? <span className="chip warn">identical copies</span> : <span className="chip">same name</span>}</div>
                  </div>
                  <div className="row wrap grow" style={{ gap: 6 }}>
                    {d.fnIds.map((fid) => {
                      const f = fnById.get(fid)
                      return f ? <span key={fid} className="chip click mono" onClick={() => openTrace(`fn:${fid}`)}>{f.file}:{f.line}</span> : null
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <div className="two-col">
          {h.orphans.length > 0 && (
            <Section title="Files nothing uses" hint="Not imported, not an entry point. Possibly dead code, or loaded in a way static analysis can't see" pad={false}>
              <div className="list">
                {h.orphans.slice(0, 60).map((o) => (
                  <div key={o.file} className="list-item" onClick={() => openTrace(`file:${o.file}`)}>
                    <code className="grow ellipsis">{o.file}</code>
                    <span className="faint small">{plural(o.functions, 'function')} · {o.loc} lines</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {h.routesWithoutCallers.length > 0 && (
            <Section title="Routes nothing in this repo calls" hint="Fine if another app, a webhook or a browser form uses them" pad={false}>
              <div className="list">
                {h.routesWithoutCallers.slice(0, 60).map((rid) => {
                  const r = routeById.get(rid)
                  return r ? (
                    <div key={rid} className="list-item" onClick={() => openTrace(`route:${rid}`)}>
                      <Method m={r.method} /><code className="grow ellipsis">{r.path}</code><span className="faint small">{basename(r.file)}:{r.line}</span>
                    </div>
                  ) : null
                })}
              </div>
            </Section>
          )}
        </div>

        <div className="two-col">
          {h.undocumentedEnv.length > 0 && (
            <Section title="Env vars nobody documented" hint="Used in code but missing from every .env / .env.example file">
              <div className="row wrap" style={{ gap: 6 }}>{h.undocumentedEnv.map((n) => <code key={n} className="chip">{n}</code>)}</div>
            </Section>
          )}
          {h.unusedDeps.length > 0 && (
            <Section title="Dependencies never imported" hint="Declared in a manifest but no source file imports them">
              <div className="row wrap" style={{ gap: 6 }}>{h.unusedDeps.map((d) => <span key={d.manifest + d.name} className="chip" title={d.manifest}>{d.name}</span>)}</div>
            </Section>
          )}
        </div>

        <div className="two-col">
          {(h.largeFunctions.length > 0 || h.largeFiles.length > 0) && (
            <Section title="Very long code" hint="Hard to read and test. Good candidates to split" pad={false}>
              <div className="list">
                {h.largeFunctions.map((l) => {
                  const f = fnById.get(l.fnId)
                  return f ? (
                    <div key={l.fnId} className="list-item" onClick={() => openTrace(`fn:${l.fnId}`)}>
                      <code className="grow ellipsis">{fnLabel(f)}</code><span className="faint small">{l.lines} lines · {basename(f.file)}</span>
                    </div>
                  ) : null
                })}
                {h.largeFiles.map((l) => (
                  <div key={l.file} className="list-item" onClick={() => openFile(l.file)}>
                    <code className="grow ellipsis">{l.file}</code><span className="faint small">{l.loc} lines</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {(h.todos.length > 0 || h.parseErrors.length > 0) && (
            <Section title="TODOs and unparsed files" pad={false}>
              <div className="list">
                {h.parseErrors.map((p) => (
                  <div key={p.file} className="list-item" onClick={() => openFile(p.file)}>
                    <span className="chip warn">parse error</span><code className="grow ellipsis">{p.file}</code><span className="faint small ellipsis" style={{ maxWidth: 260 }}>{p.error}</span>
                  </div>
                ))}
                {h.todos.slice(0, 80).map((t, i) => (
                  <div key={i} className="list-item" onClick={() => openFile(t.file, t.line)}>
                    <span className="chip">{t.tag}</span><span className="grow ellipsis small">{t.text || '(no text)'}</span><span className="faint small">{basename(t.file)}:{t.line}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
