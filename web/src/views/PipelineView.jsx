import { Fragment, useMemo, useState } from 'react'
import { useProject } from '../context.js'
import { api } from '../lib/api.js'
import { DataInspector } from '../components/DataInspector.jsx'
import { CopyButton } from '../components/ui.jsx'
import { IconPlay, IconCode, IconTap, IconArrow } from '../lib/icons.jsx'
import { fmtMs, fmtNum, statusClass } from '../lib/format.js'

const STAGE_COLOR = { collect: '#60a5fa', process: '#a78bfa', store: '#34d399', serve: '#fbbf24', show: '#22d3ee' }
const fillParams = (p) => p.replace(/\/?\$\{[^}]+\}|\/…/, '').replace(/:(\w+)|\{(\w+)\}|<(?:\w+:)?(\w+)>|\[(\w+)\]/g, '1').replace(/\*\*?/g, 'x')

/** What a run returned, in a few words: "7 records (title, price, city)". */
function describeResult(r) {
  if (!r) return ''
  if (!r.ok) return r.error?.message ? `failed: ${r.error.message.slice(0, 80)}` : 'failed'
  const p = r.profile
  if (p?.rows != null) return `${fmtNum(p.rows)} ${p.rows === 1 ? 'record' : 'records'}${p.columns?.length ? ` (${p.columns.slice(0, 5).map((c) => c.name).join(', ')}${p.columns.length > 5 ? '…' : ''})` : ''}`
  if (typeof r.preview === 'string') return `text, ${fmtNum(r.preview.length)} characters`
  if (r.preview && typeof r.preview === 'object') return `${Object.keys(r.preview).length} fields`
  return r.type || 'done'
}

export function PipelineView() {
  const { model, fnById, routeById, testFn, openTrace, openFile, go } = useProject()
  const story = model.story
  const stages = story.stages
  const [sel, setSel] = useState(stages[0]?.id)
  const [runs, setRuns] = useState({}) // fnId -> run summary
  const [proofState, setProofState] = useState('idle')
  const [current, setCurrent] = useState(null)
  const [probes, setProbes] = useState([])
  const [probing, setProbing] = useState(false)
  const guessBase = useMemo(() => {
    const ports = model.stack.ports
    const p = ports.find((x) => x.kind === 'backend' && !x.guess) || ports.find((x) => x.kind === 'server') || ports.find((x) => !x.guess) || ports[0]
    return `http://localhost:${p?.port || 3000}`
  }, [model])
  const [base, setBase] = useState(guessBase)

  const stage = stages.find((s) => s.id === sel) || stages[0]
  const stageRuns = (s) => s.cards.flatMap((c) => c.fnIds || []).map((id) => runs[id]).filter(Boolean)

  const runProof = async () => {
    setProofState('running')
    const done = {}
    for (const step of story.proof.steps) {
      if (!step.input) continue
      if (step.from && !done[step.from]?.ok) { done[step.fnId] = { ok: false, error: { message: 'skipped: the step before it failed' } }; setRuns({ ...done }); continue }
      setCurrent(step.fnId)
      try {
        const args = step.input === 'from' ? [{ $run: done[step.from].id }] : []
        done[step.fnId] = await api(`/api/projects/${model.id}/run`, { method: 'POST', body: { fnId: step.fnId, args, timeoutMs: step.network ? 120000 : 60000 } })
      } catch (e) {
        done[step.fnId] = { ok: false, error: { message: e.message } }
      }
      setRuns({ ...done })
    }
    setCurrent(null)
    setProofState('done')
  }

  const checkApi = async () => {
    setProbing(true)
    // call through the same prefix the app's own code uses (e.g. /api, stripped by the server or dev proxy)
    const prefixes = {}
    for (const h of model.http) if (h.viaPrefix) prefixes[h.viaPrefix] = (prefixes[h.viaPrefix] || 0) + 1
    const prefix = Object.entries(prefixes).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    const gets = model.routes.filter((r) => ['GET', 'ANY', 'ALL'].includes(r.method) && !/\.\w+$/.test(r.path)).sort((a, b) => b.callerIds.length - a.callerIds.length).slice(0, 8)
    const out = []
    for (const r of gets) {
      try {
        const ex = await api('/api/tap/probe', { method: 'POST', body: { method: 'GET', url: base.replace(/\/$/, '') + prefix + fillParams(r.path), projectId: model.id } })
        out.push({ route: r, ex })
      } catch (e) {
        out.push({ route: r, ex: { status: 0, error: e.message } })
      }
      setProbes([...out])
    }
    setProbing(false)
  }

  // talking points, plus what the proof runs showed
  const proofTalk = useMemo(() => {
    const lines = []
    const ran = (story.proof?.steps || []).filter((s) => runs[s.fnId])
    if (ran.length) {
      const chain = ran.map((s) => `${s.label} → ${describeResult(runs[s.fnId])}`)
      lines.push(`Ran the pipeline on its saved input: ${chain.join('; ')}.`)
      const flagged = ran.flatMap((s) => (runs[s.fnId]?.profile?.warnings || []).filter((w) => w.level === 'warn').map((w) => `${s.label}: ${w.column ? w.column + ' ' : ''}${w.text}`))
      if (flagged.length) lines.push(`The data check flagged ${flagged.slice(0, 3).join('; ')}.`)
      else if (ran.every((s) => runs[s.fnId]?.ok)) lines.push('Every step ran cleanly, with no empty columns, mixed types or duplicates.')
    }
    const okProbes = probes.filter((p) => p.ex.status >= 200 && p.ex.status < 300)
    if (probes.length) {
      lines.push(`The running API answered ${okProbes.length} of ${probes.length} endpoints checked${okProbes[0] ? `, e.g. ${okProbes[0].route.method} ${okProbes[0].route.path} returned ${okProbes[0].ex.response?.body?.kind === 'json' && Array.isArray(okProbes[0].ex.response.body.json) ? `${okProbes[0].ex.response.body.json.length} records` : 'data'}` : ''}.`)
    }
    return lines
  }, [runs, probes, story])
  const talk = [...story.talking, ...proofTalk]

  if (!stages.length) {
    return (
      <div className="page"><div className="page-inner">
        <h1>{model.name}</h1>
        <p className="lead">{story.summary}</p>
        <div className="row"><button onClick={() => go('overview')}>See the stack and files</button></div>
      </div></div>
    )
  }

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1280 }}>
        <div>
          <div className="section-title">How it works</div>
          <h1 style={{ marginTop: 4 }}>{model.name}</h1>
          <p className="lead">{story.summary}</p>
          {(story.builtWith.length > 0 || story.languages?.length > 0) && (
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              {story.builtWith.map((b) => <span key={b.role} className="chip"><span className="faint">{b.role}</span> {b.tech.join(', ')}</span>)}
              {story.languages?.length > 0 && <span className="chip"><span className="faint">written in</span> {story.languages.join(', ')}</span>}
            </div>
          )}
        </div>

        {/* the simple workflow */}
        <div className="wf">
          {stages.map((s, i) => {
            const r = stageRuns(s)
            const last = r[r.length - 1]
            const probeOk = s.id === 'serve' && probes.length ? `${probes.filter((p) => p.ex.status >= 200 && p.ex.status < 300).length}/${probes.length} answered` : null
            return (
              <Fragment key={s.id}>
                <button className={`wf-step${stage.id === s.id ? ' on' : ''}`} style={{ '--c': STAGE_COLOR[s.id] }} onClick={() => setSel(s.id)}>
                  <div className="wf-top"><span className="wf-num">{i + 1}</span>{s.title}</div>
                  <div className="wf-head">{s.headline}</div>
                  <ul className="wf-items">
                    {s.cards.slice(0, 3).map((c, k) => <li key={k}>{c.title}</li>)}
                    {(s.cards.length > 3 || s.more > 0) && <li className="faint">+{s.cards.length - 3 + (s.more || 0)} more</li>}
                  </ul>
                  {last && <div className={`wf-proof${last.ok ? '' : ' bad'}`}>{last.ok ? '✓' : '✗'} {describeResult(last)}</div>}
                  {probeOk && <div className="wf-proof">✓ {probeOk}</div>}
                </button>
                {i < stages.length - 1 && <div className="wf-arrow"><IconArrow size={18} /></div>}
              </Fragment>
            )
          })}
        </div>

        <div className="pipe-grid">
          {/* the selected step, explained */}
          <section className="card" style={{ '--c': STAGE_COLOR[stage.id] }}>
            <div className="stage-head">
              <div className="section-title" style={{ color: STAGE_COLOR[stage.id] }}>Step {stages.indexOf(stage) + 1} · {stage.title}</div>
              <h2 style={{ fontSize: 19, marginTop: 2 }}>{stage.headline}</h2>
            </div>
            <div className="col" style={{ gap: 14, padding: '4px 18px 18px' }}>
              {stage.cards.map((c, k) => <StageCard key={k} c={c} fnById={fnById} routeById={routeById} testFn={testFn} openTrace={openTrace} openFile={openFile} />)}
              {stage.more > 0 && <div className="faint small">and {stage.more} more screens</div>}
              {(() => {
                const r = stageRuns(stage).filter((x) => x.ok)
                const last = r[r.length - 1]
                if (!last) return null
                return (
                  <div className="col" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <b>The real data at this step</b>
                    <DataInspector value={last.preview} profile={last.profile} />
                  </div>
                )
              })()}
              {stage.id === 'serve' && probes.length > 0 && <ProbeList probes={probes} />}
            </div>
          </section>

          <aside className="col" style={{ gap: 16 }}>
            <section className="card card-pad col" style={{ gap: 10 }}>
              <h2>Prove it works</h2>
              {story.proof?.canRun ? (
                <>
                  <p className="muted small">Runs {story.proof.rootLabel}'s steps on safe input, one after another, feeding each step's output into the next. Steps that would write or send data are left out.</p>
                  <div className="col" style={{ gap: 4 }}>
                    {story.proof.steps.map((s) => (
                      <div key={s.fnId} className="proof-step">
                        <span className="proof-dot">{current === s.fnId ? <span className="spinner" style={{ width: 12, height: 12 }} /> : runs[s.fnId] ? (runs[s.fnId].ok ? '✓' : '✗') : s.input ? '○' : '–'}</span>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <code style={{ fontWeight: 600, opacity: s.input ? 1 : 0.5 }}>{s.label}</code>
                          <div className="small" style={{ color: runs[s.fnId] ? (runs[s.fnId].ok ? 'var(--text-2)' : 'var(--bad)') : 'var(--faint)' }}>
                            {runs[s.fnId] ? `${describeResult(runs[s.fnId])}${runs[s.fnId].durationMs != null ? ` · ${fmtMs(runs[s.fnId].durationMs)}` : ''}` : s.input ? s.does : s.skip}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="primary" onClick={runProof} disabled={proofState === 'running'}>
                    {proofState === 'running' ? <span className="spinner" style={{ borderTopColor: '#0b0d12' }} /> : <IconPlay size={13} />} {proofState === 'done' ? 'Run it again' : 'Run the pipeline'}
                  </button>
                </>
              ) : null}
              {model.routes.length > 0 && (
                <div className="col" style={{ gap: 6, paddingTop: story.proof?.canRun ? 10 : 0, borderTop: story.proof?.canRun ? '1px solid var(--border)' : 'none' }}>
                  <b className="small">Check the API is serving real data</b>
                  <p className="muted small">Start the app first{model.stack.parts.find((p) => p.run[0])?.run[0] ? ` (${model.stack.parts.find((p) => p.run[0]).run[0].cmd})` : ''}, then hit its read-only endpoints.</p>
                  <div className="row" style={{ gap: 6 }}>
                    <input className="mono grow" value={base} onChange={(e) => setBase(e.target.value)} />
                    <button onClick={() => { setSel('serve'); checkApi() }} disabled={probing}>{probing ? <span className="spinner" /> : 'Check'}</button>
                  </div>
                  <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => go('tap')}><IconTap size={13} /> Watch real traffic instead</button>
                </div>
              )}
              {!story.proof?.canRun && !model.routes.length && <p className="muted small">No step here can run on its own with safe input. Use “Try a step” to run individual functions with inputs you choose.</p>}
            </section>

            <section className="card card-pad col" style={{ gap: 8 }}>
              <div className="spread"><h2>Talking points</h2><CopyButton text={talk.map((t) => `• ${t}`).join('\n')} label="Copy" /></div>
              <ol className="talk">{talk.map((t, i) => <li key={i}>{t}</li>)}</ol>
              {!proofTalk.length && <p className="faint small">Run the pipeline or check the API to add proof to these.</p>}
            </section>

            {story.caveats.length > 0 && (
              <section className="card card-pad col" style={{ gap: 8 }}>
                <h2>Worth knowing</h2>
                <ul className="talk warn">{story.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </section>
            )}
            {story.sidePaths.length > 0 && (
              <section className="card card-pad col" style={{ gap: 6 }}>
                <h2>Also in the code</h2>
                <div className="row wrap" style={{ gap: 6 }}>
                  {story.sidePaths.map((s, i) => <span key={i} className="chip click mono" onClick={() => (s.routeId ? openTrace(`route:${s.routeId}`) : openTrace(`fn:${s.fnId}`))}>{s.text}</span>)}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function StageCard({ c, fnById, routeById, testFn, openTrace, openFile }) {
  const fn = (c.fnIds || []).map((id) => fnById.get(id)).find((f) => f?.runnable?.ok)
  const first = (c.fnIds || []).map((id) => fnById.get(id)).find(Boolean)
  return (
    <div className="sc">
      <div className="row wrap" style={{ gap: 8 }}>
        <b className="mono" style={{ fontSize: 13.5 }}>{c.title}</b>
        <span className="chip">{c.kind}</span>
      </div>
      <p className="sc-text">{c.explain}</p>
      {c.fields?.length > 0 && (
        <div className="row wrap" style={{ gap: 5 }}>
          <span className="faint small">Data fields</span>
          {c.fields.slice(0, 12).map((f) => <code key={f} className="chip" style={{ fontSize: 11.5 }}>{f}</code>)}
          {c.fields.length > 12 && <span className="faint small">+{c.fields.length - 12}</span>}
        </div>
      )}
      {c.routes?.length > 1 && (
        <div className="col" style={{ gap: 3 }}>
          {c.routes.slice(0, 6).map((r) => (
            <div key={r.routeId} className="row small" style={{ gap: 8, cursor: 'pointer' }} onClick={() => openTrace(`route:${r.routeId}`)}>
              <span className={`method ${r.method}`}>{r.method}</span><code>{r.path}</code><span className="muted ellipsis">{r.says}</span>
            </div>
          ))}
          {c.routes.length > 6 && <span className="faint small">+{c.routes.length - 6} more</span>}
        </div>
      )}
      {c.evidence?.length > 0 && (
        <div className="ev">
          {c.evidence.filter((e) => e.code).slice(0, 3).map((e, i) => (
            <div key={i} className="ev-line" onClick={() => openFile(e.file, e.line)} title="Open the file at this line">
              <span className="ev-loc">{e.file.split('/').pop()}:{e.line}</span>
              <code>{e.code}</code>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {first && <button className="small ghost" onClick={() => openTrace(`fn:${first.id}`)}><IconCode size={13} /> Walk through the code</button>}
        {fn && <button className="small ghost" onClick={() => testFn(fn.id)}><IconPlay size={12} /> Try {fn.name}()</button>}
        {c.routes?.length === 1 && <button className="small ghost" onClick={() => openTrace(`route:${c.routes[0].routeId}`)}>See this endpoint</button>}
      </div>
    </div>
  )
}

function ProbeList({ probes }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="col" style={{ gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
      <b>What the running API returned</b>
      {probes.map((p, i) => {
        const body = p.ex.response?.body
        const rows = body?.kind === 'json' ? (Array.isArray(body.json) ? `${body.json.length} records` : 'an object') : body?.kind || ''
        return (
          <div key={i} className="col" style={{ gap: 6 }}>
            <div className="row small" style={{ gap: 8, cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>
              <span className={`method ${p.route.method}`}>GET</span><code>{p.route.path}</code>
              <span className={statusClass(p.ex.status)}>{p.ex.status || 'no answer'}</span>
              <span className="muted">{p.ex.error ? p.ex.error.slice(0, 80) : rows}</span>
            </div>
            {open === i && body?.kind === 'json' && <DataInspector value={body.json} />}
          </div>
        )
      })}
      {probes.every((p) => !p.ex.status) && <div className="notice warn small">Nothing answered. Is the app running at that address?</div>}
    </div>
  )
}
