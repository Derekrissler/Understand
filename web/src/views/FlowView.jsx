import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesState } from '@xyflow/react'
import { useProject } from '../context.js'
import { layoutLanes, chainOf } from '../lib/layout.js'
import { LANES, RESOURCE_KIND, basename, plural } from '../lib/format.js'
import { OpBadges, Method } from '../components/ui.jsx'
import { IconSearch } from '../lib/icons.jsx'

const EDGE_COLORS = { calls: '#60a5fa', handled: '#a78bfa', invokes: '#4b5468', reads: '#34d399', writes: '#34d399', uses: '#6b7a90' }

const FlowNode = memo(function FlowNode({ data }) {
  const { n, dim, sel, hit, match } = data
  const cls = ['fnode']
  if (sel) cls.push('sel')
  if (dim) cls.push('dim')
  if (n.unreached) cls.push('unreached')
  if (n.type === 'call' && n.status === 'unmatched') cls.push('bad')
  if (n.type === 'call' && n.status === 'unresolved') cls.push('unsure')
  if (hit && Date.now() - new Date(hit.last.at).getTime() < 6000) cls.push('hit')
  return (
    <div className={cls.join(' ')} style={{ '--lane-color': LANES[n.lane]?.color, outline: match ? '2px solid var(--warn)' : undefined }}>
      <Handle type="target" position={Position.Left} />
      {hit && <span className={`live${hit.errors ? ' err' : ''}`} title={`${hit.count} live request(s), last status ${hit.last.status}`}>{hit.count}</span>}
      {n.type === 'file' && (
        <>
          <div className="t">{n.label}{n.entry && n.lane === 'entry' && <span className="faint small" style={{ fontWeight: 400 }}>· {n.role || 'entry'}</span>}</div>
          <div className="s">{n.unreached ? 'nothing reaches this · ' : ''}{n.sub || '(project root)'}</div>
          <OpBadges ops={n.ops} max={4} />
        </>
      )}
      {n.type === 'group' && (
        <>
          <div className="t mono"><span className="method ANY">{n.count}</span><span className="ellipsis">{n.label}</span></div>
          <div className="s">{Object.entries(n.methods).map(([m, c]) => `${m} ${c}`).join(' · ')} · click to expand</div>
        </>
      )}
      {n.type === 'route' && (
        <>
          <div className="t mono"><Method m={n.method} /><span className="ellipsis">{n.path}</span></div>
          <div className="s">{basename(n.file)} · {n.framework}</div>
        </>
      )}
      {n.type === 'call' && (
        <>
          <div className="t mono"><Method m={n.method} /><span className="ellipsis">{n.path}</span></div>
          <div className="s" style={{ color: n.status === 'unmatched' ? 'var(--bad)' : 'var(--warn)' }}>
            {n.status === 'unmatched' ? 'no route matches this call' : 'base URL decided at runtime'} · {plural(n.httpIds.length, 'call')}
          </div>
        </>
      )}
      {n.type === 'resource' && (
        <>
          <div className="t mono"><span className="ellipsis">{n.label}</span></div>
          <div className="s">{RESOURCE_KIND[n.kind] || n.kind}{n.engine ? ` · ${n.engine}` : ''}{n.reads ? ` · ${n.reads} read` : ''}{n.writes ? ` · ${n.writes} write` : ''}</div>
        </>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
})

const LaneHead = ({ data }) => (
  <div className="lane-head" style={{ '--lane-color': LANES[data.lane].color }}>
    {LANES[data.lane].label}{data.step ? ` · step ${data.step}` : ''}
    <span>{LANES[data.lane].hint}</span>
  </div>
)
const nodeTypes = { flow: FlowNode, lane: LaneHead }

export function FlowView() {
  const { model, tap, openTrace, params } = useProject()
  const [showUnreached, setShowUnreached] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(params.node || null)
  const [grouping, setGrouping] = useState(() => model.routes.length > 24)
  const [expanded, setExpanded] = useState(() => new Set())
  const [, setTick] = useState(0)
  const rf = useRef(null)
  const moved = useRef(new Map())

  useEffect(() => {
    if (!tap.status.running) return
    const t = setInterval(() => setTick((x) => x + 1), 1500)
    return () => clearInterval(t)
  }, [tap.status.running])
  useEffect(() => {
    if (params.node) {
      setSelected(params.node)
      openTrace(params.node)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.node])

  const visible = useMemo(() => model.flow.nodes.filter((n) => showUnreached || !n.unreached), [model, showUnreached])
  const ids = useMemo(() => new Set(visible.map((n) => n.id)), [visible])
  const rawEdges = useMemo(() => model.flow.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), [model, ids])

  // Big APIs: fold routes into groups by path prefix (/courses/…), expandable on click.
  const { shown, edges } = useMemo(() => {
    if (!grouping) return { shown: visible, edges: rawEdges }
    const routes = visible.filter((n) => n.type === 'route')
    const lits = (p) => String(p).split('/').filter((x) => x && !/^(:|\{|<|\[|\$|\*)/.test(x))
    const keyOf = (r) => `/${lits(r.path)[0] || ''}`
    const groups = new Map()
    for (const r of routes) {
      const k = keyOf(r)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    const remap = new Map()
    const out = visible.filter((n) => n.type !== 'route')
    for (const [k, list] of groups) {
      if (list.length < 2 || expanded.has(k)) { out.push(...list); continue }
      const gid = `group:${k}`
      const methods = {}
      for (const r of list) methods[r.method] = (methods[r.method] || 0) + 1
      out.push({ id: gid, type: 'group', lane: 'api', key: k, label: `${k === '/' ? '' : k}/…`, count: list.length, methods, routeIds: list.map((r) => r.routeId), group: k })
      for (const r of list) remap.set(r.id, gid)
    }
    const merged = new Map()
    for (const e of rawEdges) {
      const source = remap.get(e.source) || e.source
      const target = remap.get(e.target) || e.target
      const id = `${source}->${target}:${e.kind}`
      if (!merged.has(id)) merged.set(id, { ...e, id, source, target, count: 0 })
      merged.get(id).count += e.count
    }
    return { shown: out, edges: [...merged.values()] }
  }, [grouping, expanded, visible, rawEdges])
  const groupCount = shown.filter((n) => n.type === 'group').length
  const layout = useMemo(() => layoutLanes(shown, edges), [shown, edges])
  const chain = useMemo(() => (selected && shown.some((n) => n.id === selected) ? chainOf(selected, edges) : null), [selected, edges, shown])
  const q = query.trim().toLowerCase()
  const matches = useMemo(() => (q ? new Set(shown.filter((n) => `${n.label} ${n.path || ''} ${n.sub || ''}`.toLowerCase().includes(q)).map((n) => n.id)) : null), [q, shown])

  const built = useMemo(() => {
    const heads = layout.headers.map((h) => ({ id: h.id, type: 'lane', position: { x: h.x, y: h.y }, data: h, draggable: false, selectable: false }))
    const groupHit = (n) => {
      const hs = n.routeIds.map((id) => tap.hits.get(id)).filter(Boolean)
      if (!hs.length) return null
      const last = hs.map((h) => h.last).sort((a, b) => new Date(b.at) - new Date(a.at))[0]
      return { count: hs.reduce((a, h) => a + h.count, 0), errors: hs.reduce((a, h) => a + h.errors, 0), last }
    }
    const ns = shown.map((n) => ({
      id: n.id,
      type: 'flow',
      position: moved.current.get(n.id) || layout.positions.get(n.id),
      data: {
        n,
        sel: selected === n.id,
        dim: (chain && !chain.has(n.id)) || (matches && !matches.has(n.id)),
        match: matches?.has(n.id),
        hit: n.type === 'route' ? tap.hits.get(n.routeId) : n.type === 'group' ? groupHit(n) : null,
      },
    }))
    return [...heads, ...ns]
  }, [layout, shown, selected, chain, matches, tap.hits])
  const [nodes, setNodes, onNodesChange] = useNodesState(built)
  useEffect(() => setNodes(built), [built, setNodes])

  const nodeById = useMemo(() => new Map(model.flow.nodes.map((n) => [n.id, n])), [model])
  const rfEdges = useMemo(() => {
    const recent = new Set()
    for (const [rid, h] of tap.hits) if (Date.now() - new Date(h.last.at).getTime() < 6000) recent.add(`route:${rid}`)
    for (const n of shown) if (n.type === 'group' && n.routeIds.some((id) => recent.has(`route:${id}`))) recent.add(n.id)
    return edges.map((e) => {
      const target = nodeById.get(e.target)
      const bad = target?.type === 'call' && target.status === 'unmatched'
      const color = bad ? '#f87171' : EDGE_COLORS[e.kind] || '#4b5468'
      const faded = chain && !(chain.has(e.source) && chain.has(e.target))
      const live = recent.has(e.target) || recent.has(e.source)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: live || (!!chain && !faded && e.kind !== 'invokes'),
        label: e.kind === 'calls' ? e.label : e.kind === 'writes' ? 'writes' : undefined,
        style: { stroke: live ? '#34d399' : color, strokeWidth: live ? 2.4 : e.kind === 'invokes' ? 1.2 : 1.6, opacity: faded ? 0.08 : 0.9, strokeDasharray: e.kind === 'reads' || bad ? '5 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: live ? '#34d399' : color, width: 14, height: 14 },
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, chain, tap.hits, nodeById, shown, tap.exchanges.length])

  useEffect(() => {
    const t = setTimeout(() => rf.current?.fitView({ padding: 0.12, duration: 250 }), 30)
    return () => clearTimeout(t)
  }, [showUnreached, grouping, expanded])

  const counts = useMemo(() => {
    const c = { route: 0, unmatched: 0, resource: 0, unreached: 0 }
    for (const n of model.flow.nodes) {
      if (n.type === 'route') c.route++
      if (n.type === 'call' && n.status === 'unmatched') c.unmatched++
      if (n.type === 'resource') c.resource++
      if (n.unreached) c.unreached++
    }
    return c
  }, [model])

  if (!model.flow.nodes.length) {
    return (
      <div className="page"><div className="page-inner">
        <h1>Flow</h1>
        <div className="card empty">
          No workflow found: no API routes, network calls, or data operations were detected.<br />
          The Modules view still shows how the files depend on each other.
        </div>
      </div></div>
    )
  }

  return (
    <div className="main" style={{ height: '100%' }}>
      <div className="flow-toolbar">
        <div className="row" style={{ gap: 6, position: 'relative' }}>
          <IconSearch size={14} style={{ position: 'absolute', left: 9, color: 'var(--faint)' }} />
          <input style={{ paddingLeft: 28, width: 220 }} placeholder="Find a file, route or table" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="check"><input type="checkbox" checked={showUnreached} onChange={(e) => setShowUnreached(e.target.checked)} /> Unreached code ({counts.unreached})</label>
        {model.routes.length > 8 && (
          <label className="check"><input type="checkbox" checked={grouping} onChange={(e) => { setGrouping(e.target.checked); setExpanded(new Set()) }} /> Group routes{grouping && groupCount ? ` (${groupCount})` : ''}</label>
        )}
        {grouping && expanded.size > 0 && <button className="small" onClick={() => setExpanded(new Set())}>Collapse groups</button>}
        <div className="legend">
          {Object.entries(LANES).map(([k, l]) => <span key={k}><span className="sw" style={{ background: l.color }} />{l.label}</span>)}
          {counts.unmatched > 0 && <span style={{ color: 'var(--bad)' }}>● {plural(counts.unmatched, 'broken call')}</span>}
        </div>
        <span className="grow" />
        {tap.status.running ? <span className="live-pill"><span className="dot" />live: {tap.exchanges.filter((x) => x.routeId).length} hits</span> : <span className="faint small">Click any box to see its code path</span>}
        {selected && <button className="small" onClick={() => setSelected(null)}>Clear selection</button>}
      </div>
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) => {
            for (const c of changes) if (c.type === 'position' && c.position) moved.current.set(c.id, c.position)
            onNodesChange(changes)
          }}
          onInit={(inst) => (rf.current = inst)}
          onNodeClick={(_, node) => {
            if (node.type !== 'flow') return
            if (node.data.n.type === 'group') {
              setExpanded((x) => new Set([...x, node.data.n.key]))
              return
            }
            setSelected(node.id)
            openTrace(node.id)
          }}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.08}
          maxZoom={1.8}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" gap={22} size={1} color="#1e2432" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable maskColor="rgba(11,13,18,0.75)" nodeColor={(n) => (n.type === 'lane' ? 'transparent' : n.data?.n?.status === 'unmatched' ? '#f87171' : { entry: '#60a5fa', api: '#a78bfa', logic: '#64748b', data: '#34d399' }[n.data?.n?.lane] || '#444')} />
        </ReactFlow>
      </div>
    </div>
  )
}
