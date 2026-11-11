import { useEffect, useMemo, useState } from 'react'
import { useProject } from '../context.js'
import { api } from '../lib/api.js'
import { CodeBlock } from '../components/CodeBlock.jsx'
import { DataInspector } from '../components/DataInspector.jsx'
import { CatChip, Method, RoleBadge, Loading } from '../components/ui.jsx'
import { IconX, IconPlay, IconTap, IconExternal } from '../lib/icons.jsx'
import { RESOURCE_KIND, basename, fnLabel, plural, statusClass, fmtMs, timeAgo } from '../lib/format.js'

const ROLE = {
  caller: { label: 'Called from', color: 'var(--lane-entry)' },
  handler: { label: 'Handled by', color: 'var(--lane-api)' },
  callee: { label: 'Which calls', color: 'var(--lane-logic)' },
  'in-file': { label: 'In this file', color: 'var(--lane-logic)' },
  touches: { label: 'Touched by', color: 'var(--lane-data)' },
  focus: { label: 'This function', color: 'var(--accent)' },
}

export function Drawer({ drawer }) {
  const { closeDrawer } = useProject()
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && closeDrawer()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [closeDrawer])
  return (
    <div className="drawer">
      {drawer.type === 'trace' ? <TracePanel node={drawer.node} /> : <FilePanel path={drawer.path} line={drawer.line} />}
    </div>
  )
}

function Head({ kicker, title, children }) {
  const { closeDrawer } = useProject()
  return (
    <div className="drawer-head">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="section-title">{kicker}</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, wordBreak: 'break-all' }}>{title}</div>
        {children}
      </div>
      <button className="ghost" onClick={closeDrawer} title="Close (Esc)"><IconX /></button>
    </div>
  )
}

function FilePanel({ path, line }) {
  const { id, model, openTrace } = useProject()
  const f = model.files.find((x) => x.path === path)
  return (
    <>
      <Head kicker="File" title={path}>
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          {f?.role && <RoleBadge role={f.role} />}
          {f?.entry && <span className="chip accent">{f.entry}</span>}
          <button className="small" onClick={() => openTrace(`file:${path}`)}>Trace this file</button>
        </div>
      </Head>
      <div className="drawer-body">
        <CodeBlock projectId={id} path={path} focus={line ? [line] : []} fold={false} tall scrollTo={line} maxLines={6000} />
      </div>
    </>
  )
}

function TracePanel({ node }) {
  const { id, model, routeById, httpById, fnById, tap, probeRoute, openFile, openTrace } = useProject()
  const [trace, setTrace] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    setTrace(null)
    setError(null)
    api(`/api/projects/${id}/trace?node=${encodeURIComponent(node)}`).then(setTrace).catch((e) => setError(e.message))
  }, [id, node])

  const flowNode = model.flow.nodes.find((n) => n.id === node)
  const route = node.startsWith('route:') ? routeById.get(node.slice(6)) : null
  const liveHits = route ? tap.exchanges.filter((x) => x.routeId === route.id) : []
  const lastLive = liveHits[liveHits.length - 1]

  let kicker = 'Trace'
  let title = node
  let sub = null
  if (route) {
    kicker = 'API route'
    title = <span className="row"><Method m={route.method} /><span className="mono">{route.path}</span></span>
    sub = (
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        <span className="chip">{route.framework}</span>
        <span className="chip mono">{route.file}:{route.line}</span>
        <span className="chip">{plural(route.callerIds.length, 'caller')} in code</span>
        <button className="small primary" onClick={() => probeRoute(route.id)}><IconTap size={13} /> Send a real request</button>
      </div>
    )
  } else if (node.startsWith('file:')) {
    const f = model.files.find((x) => x.path === node.slice(5))
    kicker = 'File'
    title = node.slice(5)
    sub = (
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {f?.role && <RoleBadge role={f.role} />}
        {f?.entry && <span className="chip accent">{f.entry}</span>}
        {flowNode?.unreached && <span className="chip warn">no route or entry point reaches this</span>}
        {f && <span className="chip">imported by {f.importedBy.length}</span>}
        <button className="small" onClick={() => openFile(node.slice(5))}><IconExternal size={13} /> Whole file</button>
      </div>
    )
  } else if (node.startsWith('res:')) {
    const r = model.resources.find((x) => `res:${x.key}` === node)
    kicker = RESOURCE_KIND[r?.kind] || 'Resource'
    title = r?.label || node
    sub = (
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        {r?.engine && <span className="chip">{r.engine}</span>}
        {r && <span className="chip">{r.reads} reads · {r.writes} writes · {plural(r.files.length, 'file')}</span>}
        {r?.kind === 'file' && model.files.some((f) => f.path === r.label) && <button className="small" onClick={() => openFile(r.label)}>Open this file</button>}
      </div>
    )
  } else if (node.startsWith('call:')) {
    kicker = flowNode?.status === 'unmatched' ? 'Broken call' : 'Unresolved call'
    title = <span className="row"><Method m={flowNode?.method || 'GET'} /><span className="mono">{flowNode?.path}</span></span>
  } else if (node.startsWith('fn:')) {
    const fn = fnById.get(node.slice(3))
    kicker = 'Function'
    title = fnLabel(fn)
    sub = fn && <div className="faint small mono" style={{ marginTop: 4 }}>{fn.file}:{fn.line}</div>
  }

  return (
    <>
      <Head kicker={kicker} title={title}>{sub}</Head>
      <div className="drawer-body">
        {route && (lastLive ? (
          <div className="card card-pad col" style={{ gap: 10, borderColor: 'rgba(52,211,153,0.35)' }}>
            <div className="spread">
              <b>Latest live response</b>
              <span className="small muted"><span className={statusClass(lastLive.status)}>{lastLive.status || 'ERR'}</span> · {fmtMs(lastLive.ms)} · {timeAgo(lastLive.at)} · {plural(liveHits.length, 'hit')}</span>
            </div>
            {lastLive.error ? <div className="notice bad">{lastLive.error}</div> : <BodyView body={lastLive.response?.body} />}
          </div>
        ) : (
          <div className="notice"><span>ℹ</span><span>No live traffic for this route yet. Start the Live tap, or send a request, to see the real data it returns.</span></div>
        ))}

        {trace?.kind === 'call' && (
          <div className="col" style={{ gap: 8 }}>
            {trace.status === 'unmatched' ? (
              <div className="notice bad"><span>⚠</span><span>The code calls this endpoint, but no route in the project serves it. At runtime this is a 404 (or a 405 if only the method is wrong).</span></div>
            ) : (
              <div className="notice warn"><span>?</span><span>The URL's base is only known at runtime (an env var or config), so it couldn't be matched with certainty. Use the Live tap to confirm where it goes.</span></div>
            )}
            {trace.suggestions?.length > 0 && (
              <div className="card card-pad col" style={{ gap: 6 }}>
                <b className="small">Did it mean…</b>
                {trace.suggestions.map((s, i) => (
                  <div key={i} className="row" style={{ cursor: 'pointer' }} onClick={() => openTrace(`route:${s.routeId}`)}>
                    <Method m={s.route.method} /><code>{s.route.path}</code><span className="faint small">{s.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <div className="notice bad">{error}</div>}
        {!trace && !error && <Loading label="Tracing…" />}
        {trace && (
          <div className="steps">
            {trace.steps.length === 0 && <div className="muted">No functions to show for this node.</div>}
            {trace.steps.map((s, i) => <Step key={`${s.fnId}-${i}`} s={s} />)}
          </div>
        )}
      </div>
    </>
  )
}

export function BodyView({ body }) {
  if (!body || body.kind === 'empty') return <div className="muted small">Empty body</div>
  if (body.kind === 'json' || body.kind === 'form') return <DataInspector value={body.json} />
  if (body.kind === 'binary') return <div className="muted small">Binary ({body.contentType}, {body.size} bytes)</div>
  return <pre className="out">{body.text}{body.truncated ? '\n… (truncated)' : ''}</pre>
}

function Step({ s }) {
  const { id, testFn, openTrace, fnById } = useProject()
  const role = ROLE[s.role] || ROLE.callee
  const focus = [s.focusLine].filter(Boolean)
  // lines in this function that lead to the next step(s) shown
  const handoffs = s.links.map((l) => l.line)
  const ops = [...s.ops.map((o) => ({ line: o.line, label: o.label, cat: o.cat })), ...s.http.map((h) => ({ line: h.line, label: `${h.method} ${h.url ?? '(dynamic)'}`, cat: 'http' }))]
  const from = s.from ? fnById.get(s.from) : null
  return (
    <div className="step" style={{ '--role-color': role.color }}>
      <span className="bullet" />
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="step-role">{role.label}{from && s.role === 'callee' ? <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> ← {fnLabel(from)}</span> : null}</div>
          <div className="step-title ellipsis" title={s.qual}>{s.qual === '<module>' ? `${basename(s.file)} (top level)` : s.qual === '<main>' ? `${basename(s.file)} __main__` : s.qual}</div>
          <div className="faint small mono ellipsis">{s.file}:{s.line}</div>
        </div>
        <div className="row" style={{ flex: 'none' }}>
          {s.runnable?.ok && <button className="small" onClick={() => testFn(s.fnId)} title="Open in the Test bench"><IconPlay size={12} /> Run</button>}
          <button className="small ghost" onClick={() => openTrace(`fn:${s.fnId}`)} title="Trace from this function">Trace</button>
        </div>
      </div>
      {s.doc && <div className="muted small" style={{ marginTop: 4 }}>{s.doc}</div>}
      {s.note && <div className="small" style={{ marginTop: 4, color: 'var(--text-2)' }}>{s.note}</div>}
      {(s.ops.length > 0 || s.links.length > 0) && (
        <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
          {[...new Set(s.ops.map((o) => o.cat))].map((c) => <CatChip key={c} cat={c} count={s.ops.filter((o) => o.cat === c).length} />)}
          {s.links.slice(0, 4).map((l, i) => <span key={i} className="chip mono" style={{ cursor: 'pointer' }} onClick={() => openTrace(`fn:${l.to}`)}>L{l.line} → {l.toName}</span>)}
          {s.links.length > 4 && <span className="faint small">+{s.links.length - 4} calls</span>}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <CodeBlock projectId={id} path={s.file} start={s.line} end={s.endLine} focus={[...focus, ...handoffs.slice(0, 6)]} ops={ops} context={2} />
      </div>
    </div>
  )
}
