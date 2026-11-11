import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, MarkerType } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import { useProject } from '../context.js'
import { ROLE_COLORS, basename, fmtNum, plural } from '../lib/format.js'
import { OpBadges } from '../components/ui.jsx'
import { IconSearch } from '../lib/icons.jsx'

const W = 210
const H = 46
const CODE = new Set(['javascript', 'typescript', 'vue', 'svelte', 'astro', 'python', 'notebook', 'java', 'html'])

const ModNode = memo(function ModNode({ data }) {
  const { item, dim, sel } = data
  return (
    <div className={`fnode${dim ? ' dim' : ''}${sel ? ' sel' : ''}`} style={{ width: W, minHeight: H, '--lane-color': item.color }}>
      <Handle type="target" position={Position.Left} />
      <div className="t">{item.label}</div>
      <div className="s">{item.sub}</div>
      {item.ops && Object.keys(item.ops).length > 0 && <OpBadges ops={item.ops} max={3} />}
      <Handle type="source" position={Position.Right} />
    </div>
  )
})
const nodeTypes = { mod: ModNode }

function layout(items, links) {
  const g = new dagre.graphlib.Graph({ multigraph: false })
  g.setGraph({ rankdir: 'LR', nodesep: 10, ranksep: 70, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const it of items) g.setNode(it.id, { width: W, height: H + (it.ops && Object.keys(it.ops).length ? 16 : 0) })
  for (const l of links) if (l.source !== l.target) g.setEdge(l.source, l.target)
  dagre.layout(g)
  return new Map(items.map((it) => {
    const n = g.node(it.id)
    return [it.id, { x: n.x - W / 2, y: n.y - n.height / 2 }]
  }))
}

export function ModulesView() {
  const { model, openTrace } = useProject()
  const codeFiles = useMemo(() => model.files.filter((f) => CODE.has(f.lang)), [model])
  const [mode, setMode] = useState(codeFiles.length > 140 ? 'folders' : 'files')
  const [depth, setDepth] = useState(2)
  const [showTests, setShowTests] = useState(false)
  const [scope, setScope] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const rf = useRef(null)

  const files = useMemo(() => codeFiles.filter((f) => (showTests || (f.role !== 'test' && f.role !== 'config')) && (!scope || f.path.startsWith(scope + '/') || f.path === scope)), [codeFiles, showTests, scope])
  const { items, links, capped } = useMemo(() => {
    const fileSet = new Set(files.map((f) => f.path))
    if (mode === 'folders') {
      const groupOf = (p) => {
        const rel = scope ? p.slice(scope.length + 1) : p
        const parts = rel.split('/')
        const g = parts.length > 1 ? parts.slice(0, Math.min(depth, parts.length - 1)).join('/') : '(root files)'
        return scope ? `${scope}/${g}` : g
      }
      const groups = new Map()
      for (const f of files) {
        const g = groupOf(f.path)
        if (!groups.has(g)) groups.set(g, { id: g, files: [], roles: {}, ops: {} })
        const gr = groups.get(g)
        gr.files.push(f)
        gr.roles[f.role] = (gr.roles[f.role] || 0) + 1
        for (const [c, n] of Object.entries(f.ops)) gr.ops[c] = (gr.ops[c] || 0) + n
      }
      const counts = new Map()
      for (const f of files) for (const t of f.imports) {
        if (!fileSet.has(t)) continue
        const a = groupOf(f.path)
        const b = groupOf(t)
        if (a === b) continue
        counts.set(`${a}\u0000${b}`, (counts.get(`${a}\u0000${b}`) || 0) + 1)
      }
      const items = [...groups.values()].map((g) => {
        const role = Object.entries(g.roles).sort((a, b) => b[1] - a[1])[0]?.[0]
        return { id: g.id, label: g.id.split('/').slice(-2).join('/') + '/', sub: `${plural(g.files.length, 'file')} · mostly ${role}`, color: ROLE_COLORS[role], ops: g.ops, folder: true }
      })
      const links = [...counts].map(([k, n]) => {
        const [a, b] = k.split('\u0000')
        return { id: k, source: a, target: b, n }
      })
      return { items, links, capped: false }
    }
    let list = files
    const q = query.trim().toLowerCase()
    if (q) {
      const hits = new Set(files.filter((f) => f.path.toLowerCase().includes(q)).map((f) => f.path))
      const near = new Set(hits)
      for (const f of files) {
        if (hits.has(f.path)) for (const t of f.imports) near.add(t)
        if (f.imports.some((t) => hits.has(t))) near.add(f.path)
      }
      list = files.filter((f) => near.has(f.path))
    }
    const capped = list.length > 350
    list = list.slice(0, 350)
    const set = new Set(list.map((f) => f.path))
    const items = list.map((f) => ({ id: f.path, label: basename(f.path), sub: `${f.path.split('/').slice(-3, -1).join('/') || '(root)'} · ${f.role}`, color: ROLE_COLORS[f.role], ops: f.ops, file: f }))
    const links = []
    for (const f of list) for (const t of f.imports) if (set.has(t) && t !== f.path) links.push({ id: `${f.path}->${t}`, source: f.path, target: t, n: 1 })
    return { items, links, capped }
  }, [files, mode, depth, query, scope])

  const positions = useMemo(() => layout(items, links), [items, links])
  const neigh = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    for (const l of links) {
      if (l.source === selected) s.add(l.target)
      if (l.target === selected) s.add(l.source)
    }
    return s
  }, [selected, links])

  const nodes = useMemo(() => items.map((it) => ({ id: it.id, type: 'mod', position: positions.get(it.id), data: { item: it, dim: neigh && !neigh.has(it.id), sel: selected === it.id } })), [items, positions, neigh, selected])
  const edges = useMemo(() => links.map((l) => {
    const on = neigh && (l.source === selected || l.target === selected)
    return {
      id: l.id, source: l.source, target: l.target,
      style: { stroke: on ? '#7c9cff' : '#3a4256', strokeWidth: Math.min(1 + Math.log2(l.n), 4), opacity: neigh && !on ? 0.06 : 0.8 },
      markerEnd: { type: MarkerType.ArrowClosed, color: on ? '#7c9cff' : '#3a4256', width: 12, height: 12 },
      label: mode === 'folders' && l.n > 1 ? String(l.n) : undefined,
    }
  }), [links, neigh, selected, mode])

  useEffect(() => {
    const t = setTimeout(() => rf.current?.fitView({ padding: 0.1, duration: 200 }), 40)
    return () => clearTimeout(t)
  }, [items])

  return (
    <div className="main" style={{ height: '100%' }}>
      <div className="flow-toolbar">
        <div className="row" style={{ gap: 0 }}>
          <button className={mode === 'folders' ? 'primary small' : 'small'} onClick={() => setMode('folders')}>Folders</button>
          <button className={mode === 'files' ? 'primary small' : 'small'} onClick={() => setMode('files')}>Files</button>
        </div>
        {mode === 'folders' && (
          <label className="check">depth
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>{[1, 2, 3, 4].map((d) => <option key={d}>{d}</option>)}</select>
          </label>
        )}
        {mode === 'files' && (
          <div className="row" style={{ position: 'relative' }}>
            <IconSearch size={14} style={{ position: 'absolute', left: 9, color: 'var(--faint)' }} />
            <input style={{ paddingLeft: 28, width: 220 }} placeholder="Focus on files matching…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        <label className="check"><input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Tests & config</label>
        {scope && <span className="chip accent">in {scope}/ <button className="ghost small" onClick={() => setScope('')}>×</button></span>}
        <div className="legend">
          {['frontend', 'backend', 'script', 'shared'].map((r) => <span key={r}><span className="sw" style={{ background: ROLE_COLORS[r] }} />{r}</span>)}
        </div>
        <span className="grow" />
        <span className="faint small">{fmtNum(items.length)} {mode === 'folders' ? 'folders' : 'files'} · {fmtNum(links.length)} import links{capped ? ' · showing first 350: search to focus' : ''}</span>
      </div>
      <div className="flow-wrap">
        {items.length === 0 ? <div className="empty">No code files to show.</div> : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(i) => (rf.current = i)}
            onNodeClick={(_, n) => {
              const it = n.data.item
              setSelected(n.id)
              if (it.folder) {
                if (it.id !== '(root files)') {
                  setScope(it.id)
                  setSelected(null)
                  setMode(codeFiles.filter((f) => f.path.startsWith(it.id + '/')).length > 140 ? 'folders' : 'files')
                }
              } else openTrace(`file:${it.id}`)
            }}
            onPaneClick={() => setSelected(null)}
            fitView
            minZoom={0.05}
            maxZoom={1.6}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant="dots" gap={22} size={1} color="#1e2432" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}
