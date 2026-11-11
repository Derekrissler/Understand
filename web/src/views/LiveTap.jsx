import { useEffect, useMemo, useState } from 'react'
import { useProject } from '../context.js'
import { api } from '../lib/api.js'
import { BodyView } from '../panels/Drawer.jsx'
import { Method } from '../components/ui.jsx'
import { fmtMs, fmtBytes, statusClass, plural } from '../lib/format.js'
import { IconTap, IconTrace } from '../lib/icons.jsx'

const samplePath = (p) => p.replace(/\/?\$\{[^}]+\}/, '').replace(/:(\w+)|\{(\w+)\}|<(?:\w+:)?(\w+)>|\[(\w+)\]/g, '1').replace(/\*\*?/g, 'x')

export function LiveTap() {
  const { model, tap, params, routeById, openTrace, id } = useProject()
  const guess = useMemo(() => {
    const ports = model.stack.ports
    const p = ports.find((x) => x.kind === 'backend' && !x.guess) || ports.find((x) => x.kind === 'server') || ports.find((x) => x.kind === 'docker') || ports.find((x) => !x.guess) || ports[0]
    return `http://localhost:${p?.port || 3000}`
  }, [model])
  const [target, setTarget] = useState(tap.status.target || guess)
  const [port, setPort] = useState(tap.status.port || 4999)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [hideAssets, setHideAssets] = useState(true)
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(null)

  const preRoute = params.route ? routeById.get(params.route) : null
  const [method, setMethod] = useState(preRoute?.method && !['ANY', 'ALL', 'WS'].includes(preRoute.method) ? preRoute.method : 'GET')
  const [url, setUrl] = useState(`${tap.status.target || guess}${preRoute ? samplePath(preRoute.path) : ''}`)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (preRoute) {
      setMethod(!['ANY', 'ALL', 'WS'].includes(preRoute.method) ? preRoute.method : 'GET')
      setUrl(`${(tap.status.target || target).replace(/\/$/, '')}${samplePath(preRoute.path)}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.route])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('/api/tap/start', { method: 'POST', body: { target, port: Number(port), projectId: id } })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    setBusy(true)
    try { await api('/api/tap/stop', { method: 'POST' }) } finally { setBusy(false) }
  }
  const send = async () => {
    setSending(true)
    setError(null)
    try {
      let b = body.trim() ? body : undefined
      if (b) { try { b = JSON.parse(b) } catch {} }
      const ex = await api('/api/tap/probe', { method: 'POST', body: { method, url, body: b, projectId: id } })
      setSel(ex.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return tap.exchanges.filter((x) => (!hideAssets || !x.asset) && (!q || `${x.method} ${x.path}`.toLowerCase().includes(q))).slice().reverse()
  }, [tap.exchanges, hideAssets, filter])
  const current = tap.exchanges.find((x) => x.id === sel) || list[0]
  const urlEnv = model.stack.env.filter((e) => /(API|BASE|BACKEND|SERVER|HOST)[_A-Z]*(URL|HOST|ENDPOINT|ORIGIN)?$|_URL$/.test(e.name)).map((e) => e.name)
  const routesSorted = model.routes.slice().sort((a, b) => a.path.localeCompare(b.path))

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1320 }}>
        <div className="page-head">
          <div>
            <h1>Live tap</h1>
            <p>A recording proxy between your frontend (or scripts) and your backend. Every request that passes through is captured, matched to its route in the Flow map, and its data checked.</p>
          </div>
        </div>

        <div className="two-col">
          <div className="card card-pad col" style={{ gap: 10 }}>
            <div className="spread">
              <b>1 · Proxy your running app</b>
              {tap.status.running ? <span className="live-pill"><span className="dot" />recording</span> : <span className="chip">stopped</span>}
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <label className="col small muted grow" style={{ gap: 3 }}>Backend URL (must already be running)
                <input className="mono" value={target} onChange={(e) => setTarget(e.target.value)} disabled={tap.status.running} />
              </label>
              <label className="col small muted" style={{ gap: 3, width: 110 }}>Tap port
                <input className="mono" type="number" value={port} onChange={(e) => setPort(e.target.value)} disabled={tap.status.running} />
              </label>
            </div>
            <div className="row">
              {tap.status.running ? <button onClick={stop} disabled={busy}>Stop</button> : <button className="primary" onClick={start} disabled={busy}><IconTap size={14} /> Start tap</button>}
              {tap.exchanges.length > 0 && <button className="ghost" onClick={() => api('/api/tap/clear', { method: 'POST' })}>Clear {tap.exchanges.length}</button>}
            </div>
            {tap.status.running && (
              <div className="notice ok col" style={{ alignItems: 'stretch', gap: 6 }}>
                <span>Now send traffic through <code>http://localhost:{tap.status.port}</code> instead of <code>{tap.status.target}</code>:</span>
                <span className="small">• If the backend serves the frontend, just open <a href={`http://localhost:${tap.status.port}`} target="_blank" rel="noreferrer">localhost:{tap.status.port}</a> and click around.</span>
                <span className="small">• If the frontend has its own dev server, point its API base URL or dev proxy at port {tap.status.port}.</span>
                {urlEnv.length > 0 && <span className="small">• This project reads {urlEnv.map((n) => <code key={n}>{n} </code>)}: set it to <code>http://localhost:{tap.status.port}</code> for scripts.</span>}
              </div>
            )}
          </div>

          <div className="card card-pad col" style={{ gap: 10 }}>
            <b>2 · Or send a request yourself</b>
            <div className="row" style={{ gap: 6 }}>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select>
              <input className="grow mono" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button className="primary" onClick={send} disabled={sending}>{sending ? <span className="spinner" /> : 'Send'}</button>
            </div>
            {routesSorted.length > 0 && (
              <select value="" onChange={(e) => {
                const r = routeById.get(e.target.value)
                if (!r) return
                setMethod(['ANY', 'ALL', 'WS'].includes(r.method) ? 'GET' : r.method)
                setUrl(`${(tap.status.target || target).replace(/\/$/, '')}${samplePath(r.path)}`)
              }}>
                <option value="">Fill from a route in this project…</option>
                {routesSorted.map((r) => <option key={r.id} value={r.id}>{r.method} {r.path}</option>)}
              </select>
            )}
            {!['GET', 'HEAD'].includes(method) && <textarea rows={4} placeholder='JSON body, e.g. [{"title": "Loft", "price": 1900}]' value={body} onChange={(e) => setBody(e.target.value)} />}
            <span className="faint small">Requests are sent from the Understand server, so CORS doesn't apply. Path parameters are filled with 1; edit the URL to change them.</span>
          </div>
        </div>

        {error && <div className="notice bad"><span>⚠</span><span>{error}</span></div>}

        <div className="card" style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)', minHeight: 420 }}>
          <div style={{ borderRight: '1px solid var(--border)', minWidth: 0 }}>
            <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
              <input className="grow" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <label className="check small"><input type="checkbox" checked={hideAssets} onChange={(e) => setHideAssets(e.target.checked)} /> hide assets</label>
            </div>
            <div className="list" style={{ maxHeight: 640, overflow: 'auto' }}>
              {list.length === 0 && <div className="empty small">No traffic yet.</div>}
              {list.map((x) => {
                const r = x.routeId ? routeById.get(x.routeId) : null
                return (
                  <div key={x.id} className={`list-item${current?.id === x.id ? ' on' : ''}`} onClick={() => setSel(x.id)} style={{ padding: '7px 12px' }}>
                    <Method m={x.method} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="mono ellipsis" style={{ fontSize: 12 }}>{x.path}{x.query}</div>
                      <div className="faint small ellipsis">{r ? `→ ${r.method} ${r.path}` : x.asset ? 'static asset' : 'no matching route'}{x.source === 'probe' ? ' · sent manually' : ''}</div>
                    </div>
                    <span className={statusClass(x.status)}>{x.status || 'ERR'}</span>
                    <span className="faint small" style={{ width: 52, textAlign: 'right' }}>{fmtMs(x.ms)}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ minWidth: 0, padding: 16 }} className="col">
            {!current ? (
              <div className="empty">Pick a request to inspect its data.</div>
            ) : (
              <Exchange x={current} route={current.routeId ? routeById.get(current.routeId) : null} onTrace={openTrace} />
            )}
          </div>
        </div>
        <div className="faint small">{plural(tap.exchanges.length, 'request')} captured. Authorization and cookie headers are masked. Bodies over 2 MB are cut off.</div>
      </div>
    </div>
  )
}

function Exchange({ x, route, onTrace }) {
  const [tab, setTab] = useState('response')
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row"><Method m={x.method} /><code className="ellipsis">{x.path}{x.query}</code></div>
          <div className="row small muted" style={{ marginTop: 4, gap: 10 }}>
            <span className={statusClass(x.status)}>{x.status || 'no response'}</span>
            <span>{fmtMs(x.ms)}</span>
            {x.response?.size != null && <span>{fmtBytes(x.response.size)}</span>}
            <span>{new Date(x.at).toLocaleTimeString()}</span>
          </div>
        </div>
        {route ? (
          <button className="small" onClick={() => onTrace(`route:${route.id}`)}><IconTrace size={13} /> {route.method} {route.path}</button>
        ) : (
          !x.asset && <span className="chip warn">no route in the code matches</span>
        )}
      </div>
      {x.error && <div className="notice bad"><span>⚠</span><span>{x.error}</span></div>}
      {!x.error && (
        <>
          <div className="tabs">
            <button className={tab === 'response' ? 'on' : ''} onClick={() => setTab('response')}>Response data</button>
            <button className={tab === 'request' ? 'on' : ''} onClick={() => setTab('request')}>Request{x.request?.size ? ` (${fmtBytes(x.request.size)})` : ''}</button>
            <button className={tab === 'headers' ? 'on' : ''} onClick={() => setTab('headers')}>Headers</button>
          </div>
          {tab === 'response' && <BodyView body={x.response?.body} />}
          {tab === 'request' && <BodyView body={x.request?.body} />}
          {tab === 'headers' && (
            <div className="two-col">
              {['request', 'response'].map((k) => (
                <div key={k} className="col" style={{ gap: 4 }}>
                  <div className="section-title">{k}</div>
                  <table className="plain small">
                    <tbody>{Object.entries(x[k]?.headers || {}).map(([h, v]) => <tr key={h}><td className="mono faint">{h}</td><td className="mono" style={{ wordBreak: 'break-all' }}>{String(v)}</td></tr>)}</tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
