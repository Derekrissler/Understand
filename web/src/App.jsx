import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, clearFileCache } from './lib/api.js'
import { ProjectCtx } from './context.js'
import { Home } from './views/Home.jsx'
import { Overview } from './views/Overview.jsx'
import { PipelineView } from './views/PipelineView.jsx'
import { FlowView } from './views/FlowView.jsx'
import { ModulesView } from './views/ModulesView.jsx'
import { KeyCode } from './views/KeyCode.jsx'
import { TestBench } from './views/TestBench.jsx'
import { LiveTap } from './views/LiveTap.jsx'
import { Issues } from './views/Issues.jsx'
import { Drawer } from './panels/Drawer.jsx'
import { Logo, IconOverview, IconFlow, IconModules, IconCode, IconTest, IconTap, IconIssues, IconRefresh } from './lib/icons.jsx'
import { fmtNum, timeAgo } from './lib/format.js'

function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1)) || '/'
  const [p, q] = h.split('?')
  const parts = p.split('/').filter(Boolean)
  const params = Object.fromEntries(new URLSearchParams(q || ''))
  if (parts[0] === 'p' && parts[1]) return { page: 'project', id: parts[1], view: parts[2] || 'pipeline', params }
  return { page: 'home', params }
}
export function hashFor(id, view, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return `#/p/${id}/${view}${q ? '?' + q : ''}`
}

// The story first; the low-level views live under "Details".
const VIEWS = [
  { id: 'pipeline', label: 'How it works', icon: IconFlow },
  { id: 'test', label: 'Try a step', icon: IconTest },
  { id: 'tap', label: 'Watch it live', icon: IconTap },
]
const DETAIL_VIEWS = [
  { id: 'overview', label: 'Stack & setup', icon: IconOverview },
  { id: 'issues', label: 'Issues', icon: IconIssues },
  { id: 'code', label: 'Key code', icon: IconCode },
  { id: 'flow', label: 'Code map', icon: IconFlow },
  { id: 'modules', label: 'Files', icon: IconModules },
]

export function App() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (route.page === 'home') return <Home />
  return <ProjectShell key={route.id} route={route} />
}

function useTapFeed(projectId) {
  const [status, setStatus] = useState({ running: false })
  const [exchanges, setExchanges] = useState([])
  useEffect(() => {
    let es
    api('/api/tap').then((t) => {
      setStatus(t)
      setExchanges(t.exchanges || [])
    }).catch(() => {})
    es = new EventSource('/api/tap/events')
    es.addEventListener('status', (e) => setStatus(JSON.parse(e.data)))
    es.addEventListener('exchange', (e) => {
      const ex = JSON.parse(e.data)
      setExchanges((xs) => [...xs.slice(-499), ex])
    })
    es.addEventListener('clear', () => setExchanges([]))
    return () => es?.close()
  }, [projectId])
  const hits = useMemo(() => {
    const m = new Map()
    for (const x of exchanges) {
      if (!x.routeId) continue
      const h = m.get(x.routeId) || { count: 0, errors: 0, last: null }
      h.count++
      if (!x.status || x.status >= 400) h.errors++
      h.last = x
      m.set(x.routeId, h)
    }
    return m
  }, [exchanges])
  return { status, exchanges, hits, setStatus }
}

function ProjectShell({ route }) {
  const { id, view, params } = route
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [drawer, setDrawer] = useState(null)
  const [pipe, setPipe] = useState(null)
  const [details, setDetails] = useState(() => DETAIL_VIEWS.some((v) => v.id === view))
  const tap = useTapFeed(id)

  useEffect(() => setDrawer(null), [view])

  const load = useCallback(() => {
    setError(null)
    return api(`/api/projects/${id}`).then(setModel).catch((e) => setError(e.message))
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  const go = useCallback((v, p = {}) => {
    location.hash = hashFor(id, v, p)
  }, [id])

  const reanalyze = async () => {
    setBusy(true)
    try {
      await api(`/api/projects/${id}/reanalyze`, { method: 'POST' })
      clearFileCache()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const ctx = useMemo(() => {
    if (!model) return null
    const fnById = new Map(model.functions.map((f) => [f.id, f]))
    const routeById = new Map(model.routes.map((r) => [r.id, r]))
    const httpById = new Map(model.http.map((h) => [h.id, h]))
    return {
      id, model, fnById, routeById, httpById, tap, go, params, view,
      openTrace: (node) => setDrawer({ type: 'trace', node }),
      openFile: (path, line) => setDrawer({ type: 'file', path, line }),
      closeDrawer: () => setDrawer(null),
      testFn: (fnId, opts = {}) => {
        if (opts.pipe) setPipe(opts.pipe)
        setDrawer(null)
        go('test', { fn: fnId })
      },
      probeRoute: (routeId) => {
        setDrawer(null)
        go('tap', { route: routeId })
      },
      pipe, setPipe,
    }
  }, [model, id, tap, go, params, view, pipe])

  if (error && !model) {
    return (
      <div className="home">
        <div className="home-inner">
          <div className="notice bad"><span>⚠</span><div>{error}</div></div>
          <div><button onClick={() => (location.hash = '#/')}>← Back to start</button></div>
        </div>
      </div>
    )
  }
  if (!ctx) {
    return (
      <div className="home"><div className="home-inner"><div className="row muted"><span className="spinner" /> Analysing project…</div></div></div>
    )
  }

  const issueCount = model.health.counts.unmatchedCalls + model.health.counts.secrets + model.health.counts.identicalDuplicates
  const counts = { tap: tap.exchanges.length || null, issues: issueCount || null }
  const View = { pipeline: PipelineView, overview: Overview, flow: FlowView, modules: ModulesView, code: KeyCode, test: TestBench, tap: LiveTap, issues: Issues }[view] || PipelineView
  const navButton = (v) => (
    <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => go(v.id)}>
      <v.icon /> {v.label}
      {counts[v.id] != null && <span className={`count${v.id === 'issues' ? ' bad' : ''}`}>{fmtNum(counts[v.id])}</span>}
    </button>
  )

  return (
    <ProjectCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand" onClick={() => (location.hash = '#/')}>
            <span className="brand-mark"><Logo /></span> Understand
          </div>
          <div className="proj">
            <div className="proj-name" title={model.root}>{model.name}</div>
            <div className="faint small">{fmtNum(model.totals.files)} files · {fmtNum(model.totals.loc)} lines</div>
            <div className="faint small">analysed {timeAgo(model.analyzedAt)}</div>
          </div>
          <nav className="nav">{VIEWS.map(navButton)}</nav>
          <div className="nav-group">
            <button onClick={() => setDetails((d) => !d)}>{details ? '▾' : '▸'} Details</button>
          </div>
          {details && <nav className="nav">{DETAIL_VIEWS.map(navButton)}</nav>}
          <div className="sidebar-foot">
            {tap.status.running && (
              <span className="live-pill" title={`Proxying :${tap.status.port} → ${tap.status.target}`}>
                <span className="dot" /> Live tap on :{tap.status.port}
              </span>
            )}
            <button onClick={reanalyze} disabled={busy} title="Re-read the folder after you change code">
              {busy ? <span className="spinner" /> : <IconRefresh size={14} />} Re-analyse
            </button>
            {error && <div className="small" style={{ color: 'var(--bad)' }}>{error}</div>}
          </div>
        </aside>
        <main className="main">
          <View />
          {drawer && <Drawer drawer={drawer} />}
        </main>
      </div>
    </ProjectCtx.Provider>
  )
}
