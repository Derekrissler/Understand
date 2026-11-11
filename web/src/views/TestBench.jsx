import { useEffect, useMemo, useRef, useState } from 'react'
import { useProject } from '../context.js'
import { api } from '../lib/api.js'
import { CodeBlock } from '../components/CodeBlock.jsx'
import { DataInspector } from '../components/DataInspector.jsx'
import { Loading } from '../components/ui.jsx'
import { IconPlay, IconPipe, IconDownload, IconSearch, IconTrace, IconX } from '../lib/icons.jsx'
import { basename, fmtMs, fnLabel, fmtBytes } from '../lib/format.js'

const hint = (p) => {
  const n = p.name.toLowerCase()
  if (p.default !== undefined) return `default: ${p.default}`
  if (/url|href|link|endpoint/.test(n)) return '"https://example.com/page"'
  if (/path|file|filename|dir/.test(n)) return '"data/input.csv"'
  if (/html|page|markup|content|text|body/.test(n)) return '"<html>…</html>" or text'
  if (/rows|records|items|data|listings|df|frame|results|list|entries/.test(n)) return '[{"field": "value"}]'
  if (/^(n|k|limit|count|page|size|max|min|top|num|id|idx|index)$|_id$|Id$/.test(p.name)) return '10'
  if (/query|q|term|search|keyword|name|title/.test(n)) return '"search text"'
  if (/flag|enabled|verbose|debug|dry/.test(n)) return 'true'
  return p.type ? `a ${p.type} (JSON)` : 'JSON value or plain text'
}

function parseArg(text, lang) {
  const t = text.trim()
  if (lang === 'python' && /^(True|False|None)$/.test(t)) return { value: t === 'True' ? true : t === 'False' ? false : null, kind: t }
  try {
    const v = JSON.parse(t)
    return { value: v, kind: v === null ? 'null' : Array.isArray(v) ? `list[${v.length}]` : typeof v }
  } catch {
    return { value: text, kind: 'text' }
  }
}

const visibleParams = (fn) => (fn?.params || []).filter((p) => !(fn.lang === 'python' && fn.kind === 'method' && /^(self|cls)$/.test(p.name)))

export function TestBench() {
  const { model, params, go, fnById, pipe, setPipe } = useProject()
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const selected = params.fn ? fnById.get(params.fn) : null

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const fns = model.functions.filter((f) => (showAll ? f.qual !== '<module>' || f.runnable?.ok : f.runnable?.ok) && (!q || `${f.qual} ${f.file}`.toLowerCase().includes(q)))
    const scripts = fns.filter((f) => f.runnable?.mode === 'script')
    const byFile = new Map()
    for (const f of fns) {
      if (f.runnable?.mode === 'script') continue
      if (!byFile.has(f.file)) byFile.set(f.file, [])
      byFile.get(f.file).push(f)
    }
    const files = [...byFile].sort((a, b) => {
      const sa = a[1].reduce((s, f) => s + f.opIds.length, 0)
      const sb = b[1].reduce((s, f) => s + f.opIds.length, 0)
      return sb - sa || a[0].localeCompare(b[0])
    })
    return { scripts, files }
  }, [model, query, showAll])

  return (
    <div className="split">
      <div className="left">
        <div style={{ padding: '16px 14px 10px' }} className="col">
          <h2>Test bench</h2>
          <p className="muted small">Run one step of the workflow on real input and check what comes out. Then pipe that output into the next step.</p>
          <div className="row" style={{ position: 'relative' }}>
            <IconSearch size={14} style={{ position: 'absolute', left: 9, color: 'var(--faint)' }} />
            <input className="grow" style={{ paddingLeft: 28 }} placeholder="Find a function" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show functions that can't run on their own</label>
        </div>
        {groups.scripts.length > 0 && (
          <>
            <div className="section-title" style={{ padding: '8px 14px' }}>Whole scripts</div>
            <div className="list">
              {groups.scripts.map((f) => <FnRow key={f.id} f={f} on={selected?.id === f.id} onClick={() => go('test', { fn: f.id })} />)}
            </div>
          </>
        )}
        {groups.files.map(([file, fns]) => (
          <div key={file}>
            <div className="section-title ellipsis" style={{ padding: '10px 14px 4px', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--mono)', fontWeight: 500 }} title={file}>{file}</div>
            <div className="list">
              {fns.map((f) => <FnRow key={f.id} f={f} on={selected?.id === f.id} onClick={() => go('test', { fn: f.id })} />)}
            </div>
          </div>
        ))}
        {!groups.scripts.length && !groups.files.length && <div className="empty small">No runnable functions match.</div>}
      </div>
      <div className="right">
        {selected ? <Bench key={selected.id} fn={selected} pipe={pipe} clearPipe={() => setPipe(null)} /> : <BenchIntro />}
      </div>
    </div>
  )
}

function FnRow({ f, on, onClick }) {
  const sig = visibleParams(f).map((p) => (p.rest ? '*' : p.kwargs ? '**' : '') + p.name).join(', ')
  return (
    <div className={`list-item${on ? ' on' : ''}`} onClick={onClick} style={{ opacity: f.runnable?.ok ? 1 : 0.45, padding: '7px 14px' }} title={f.runnable?.ok ? f.runnable.note || '' : f.runnable?.reason}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="mono ellipsis" style={{ fontSize: 12.5 }}>{f.runnable?.mode === 'script' ? fnLabel(f) : `${f.qual}(${sig})`}</div>
        {f.runnable?.mode === 'script' && <div className="faint small ellipsis">{f.file}</div>}
      </div>
      {f.opIds.length > 0 && <span className="faint small">{f.opIds.length} op{f.opIds.length > 1 ? 's' : ''}</span>}
      <span className="chip" style={{ fontSize: 10.5, padding: '0 6px' }}>{f.lang === 'python' ? 'py' : 'js'}</span>
    </div>
  )
}

function BenchIntro() {
  const { model, go } = useProject()
  const suggestions = model.insights.readFirst.map((r) => model.functions.find((f) => f.id === r.fnId)).filter((f) => f?.runnable?.ok).slice(0, 6)
  return (
    <div className="page-inner" style={{ maxWidth: 820 }}>
      <h1>Pick a step to run</h1>
      <p className="muted">Functions run in a separate process from your project's folder, with its .env loaded, using the project's virtualenv if it has one. Importing a module runs its top-level code, and anything with side effects (database writes, emails, API calls) really happens.</p>
      {suggestions.length > 0 && (
        <div className="card">
          <div className="section-title" style={{ padding: '12px 16px 4px' }}>Good places to start</div>
          <div className="list">
            {suggestions.map((f) => (
              <div key={f.id} className="list-item" onClick={() => go('test', { fn: f.id })}>
                <code className="grow">{fnLabel(f)}</code><span className="faint small">{f.file}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Bench({ fn, pipe, clearPipe }) {
  const { id, model, fnById, openTrace, testFn, go } = useProject()
  const ps = visibleParams(fn)
  const [vals, setVals] = useState(() => Object.fromEntries(ps.map((p) => [p.name, ''])))
  const [refs, setRefs] = useState({})
  const [timeout, setTimeoutS] = useState(fn.opIds.some((i) => ['scrape', 'http', 'llm'].includes(model.ops[i]?.cat)) ? 90 : 30)
  const [useEnv, setUseEnv] = useState(true)
  const [cwd, setCwd] = useState('')
  const [argv, setArgv] = useState('')
  const [defaults, setDefaults] = useState(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [runs, setRuns] = useState([])
  const [picker, setPicker] = useState(false)
  const started = useRef(0)
  const [elapsed, setElapsed] = useState(0)
  const isScript = fn.runnable?.mode === 'script'

  useEffect(() => {
    api(`/api/projects/${id}/run-defaults?fn=${encodeURIComponent(fn.id)}`).then((d) => { setDefaults(d); setCwd(d.cwd) }).catch(() => {})
    api(`/api/projects/${id}/runs`).then(setRuns).catch(() => {})
  }, [id, fn.id])
  useEffect(() => {
    if (pipe && ps[0]) {
      setRefs({ [ps[0].name]: pipe })
      clearPipe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed(Date.now() - started.current), 200)
    return () => clearInterval(t)
  }, [running])

  const build = () => {
    const args = []
    const kwargs = {}
    let skipped = false
    for (const p of ps) {
      let v
      if (refs[p.name]) v = { $run: refs[p.name].runId }
      else if (!vals[p.name].trim()) {
        if (p.default !== undefined || p.rest || p.kwargs || p.name.startsWith('{')) { skipped = true; continue }
        v = null
      } else v = parseArg(vals[p.name], fn.lang).value
      if (p.rest) { args.push(...(Array.isArray(v) ? v : [v])); continue }
      if (p.kwargs) { Object.assign(kwargs, v && typeof v === 'object' ? v : {}); continue }
      if ((skipped || p.kwonly) && fn.lang === 'python') kwargs[p.name] = v
      else {
        if (skipped && fn.lang !== 'python') args.push({ __undefined__: true })
        args.push(v)
      }
    }
    return { args, kwargs }
  }

  const run = async () => {
    setRunning(true)
    setError(null)
    started.current = Date.now()
    setElapsed(0)
    try {
      const { args, kwargs } = build()
      const r = await api(`/api/projects/${id}/run`, { method: 'POST', body: { fnId: fn.id, args, kwargs, timeoutMs: timeout * 1000, useEnv, cwd, argv: argv.trim() ? argv.trim().split(/\s+/) : [] } })
      setResult(r)
      api(`/api/projects/${id}/runs`).then(setRuns).catch(() => {})
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }
  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
  }
  const missing = ps.filter((p) => !refs[p.name] && !vals[p.name].trim() && p.default === undefined && !p.rest && !p.kwargs && !p.name.startsWith('{'))

  // likely next steps: what the callers of this function call right after it
  const nextSteps = useMemo(() => {
    // what the callers do right after calling this function; on the same line, a call
    // recorded earlier is the one wrapping it: clean(parse(html)) -> parse then clean
    const out = []
    for (const cid of fn.callers) {
      const c = fnById.get(cid)
      if (!c?.calls) continue
      const mine = c.calls.findIndex(([to]) => to === fn.id)
      if (mine < 0) continue
      const myLine = c.calls[mine][1]
      const later = c.calls.filter(([to, line], i) => to !== fn.id && (line > myLine || (line === myLine && i < mine)))
      later.sort((a, b) => a[1] - b[1])
      for (const [nid] of later) {
        const n = fnById.get(nid)
        if (n?.runnable?.ok && !out.some((x) => x.id === n.id)) out.push(n)
      }
    }
    return out.slice(0, 4)
  }, [fn, fnById])

  return (
    <div className="page-inner" style={{ maxWidth: 1060 }} onKeyDown={onKey}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="section-title">{isScript ? 'Run a script' : fn.runnable?.mode === 'method' ? 'Run a method' : 'Run a function'}</div>
          <h1 className="mono" style={{ fontSize: 19, marginTop: 4 }}>{fnLabel(fn)}</h1>
          <div className="faint small mono">{fn.file}:{fn.line}</div>
          {fn.doc && <p className="muted" style={{ marginTop: 6 }}>{fn.doc}</p>}
        </div>
        <button className="small" onClick={() => openTrace(`fn:${fn.id}`)}><IconTrace size={13} /> Trace</button>
      </div>

      {!fn.runnable?.ok && <div className="notice warn"><span>⚠</span><span>{fn.runnable?.reason}</span></div>}
      {fn.runnable?.note && <div className="notice"><span>ℹ</span><span>{fn.runnable.note}</span></div>}

      <CodeBlock projectId={id} path={fn.file} start={fn.line} end={fn.endLine} ops={fn.opIds.map((i) => model.ops[i]).map((o) => ({ line: o.line, label: o.label, cat: o.cat }))} context={2} />

      <div className="card card-pad col" style={{ gap: 12 }}>
        {isScript ? (
          <div className="col" style={{ gap: 4 }}>
            <b>Command-line arguments</b>
            <input className="mono" placeholder="--push --limit 10" value={argv} onChange={(e) => setArgv(e.target.value)} />
          </div>
        ) : ps.length === 0 ? (
          <div className="muted small">Takes no arguments.</div>
        ) : (
          ps.map((p) => (
            <div key={p.name} className="col" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 8 }}>
                <code style={{ fontWeight: 600 }}>{p.rest ? '*' : p.kwargs ? '**' : ''}{p.name}</code>
                {p.type && <span className="faint small mono">{p.type}</span>}
                {p.default !== undefined && <span className="faint small">optional</span>}
                <span className="grow" />
                {!refs[p.name] && runs.some((r) => r.hasValue) && (
                  <select className="small" value="" onChange={(e) => { const r = runs.find((x) => x.id === e.target.value); if (r) setRefs({ ...refs, [p.name]: { runId: r.id, label: r.label } }) }} style={{ fontSize: 12, padding: '2px 6px' }}>
                    <option value="">Use output of a previous run…</option>
                    {runs.filter((r) => r.hasValue).map((r) => <option key={r.id} value={r.id}>#{r.id.slice(3)} {r.label}</option>)}
                  </select>
                )}
              </div>
              {refs[p.name] ? (
                <div className="row chip accent" style={{ alignSelf: 'flex-start', padding: '4px 10px' }}>
                  <IconPipe size={13} /> output of run #{refs[p.name].runId.slice(3)} · {refs[p.name].label}
                  <button className="ghost small" onClick={() => { const n = { ...refs }; delete n[p.name]; setRefs(n) }} title="Remove"><IconX size={12} /></button>
                </div>
              ) : (
                <ArgInput value={vals[p.name]} placeholder={hint(p)} lang={fn.lang} onChange={(v) => setVals({ ...vals, [p.name]: v })} />
              )}
            </div>
          ))
        )}
        <div className="row wrap" style={{ gap: 14, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <button className="primary" onClick={run} disabled={running || !fn.runnable?.ok}>
            {running ? <span className="spinner" style={{ borderTopColor: '#0b0d12' }} /> : <IconPlay size={13} />} {running ? `Running… ${(elapsed / 1000).toFixed(1)}s` : 'Run'}
          </button>
          <span className="kbd">⌘↵</span>
          <label className="check">timeout <input type="number" min="1" max="600" value={timeout} onChange={(e) => setTimeoutS(Number(e.target.value) || 30)} style={{ width: 64 }} />s</label>
          <label className="check" title={defaults?.envFiles?.join(', ') || 'no .env files found'}><input type="checkbox" checked={useEnv} onChange={(e) => setUseEnv(e.target.checked)} /> load .env{defaults?.envFiles?.length ? ` (${defaults.envFiles.length})` : ''}</label>
          <label className="check">cwd <input className="mono" value={cwd} onChange={(e) => setCwd(e.target.value)} style={{ width: 160 }} /></label>
          <span className="faint small">{defaults?.interpreter}</span>
          {missing.length > 0 && <span className="small" style={{ color: 'var(--warn)' }}>{missing.map((p) => p.name).join(', ')} will be passed as null</span>}
        </div>
      </div>

      {error && <div className="notice bad"><span>⚠</span><span>{error}</span></div>}
      {running && !result && <Loading label="Running in a separate process…" />}
      {result && (
        <RunResult
          r={result}
          isScript={isScript}
          nextSteps={nextSteps}
          onPipe={(target) => testFn(target.id, { pipe: { runId: result.id, label: fnLabel(fn) } })}
          openPicker={() => setPicker(true)}
        />
      )}
      {picker && result && (
        <PipePicker
          exclude={fn.id}
          onPick={(target) => { setPicker(false); testFn(target.id, { pipe: { runId: result.id, label: fnLabel(fn) } }) }}
          onClose={() => setPicker(false)}
        />
      )}

      {runs.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="section-title">This session's runs</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {runs.slice(0, 16).map((r) => (
              <span key={r.id} className={`chip click ${r.ok ? '' : 'bad'}`} onClick={() => (r.fnId === fn.id ? api(`/api/runs/${r.id}`).then(setResult) : go('test', { fn: r.fnId }))} title={`${r.file} · ${fmtMs(r.durationMs ?? r.wallMs)}`}>
                {r.ok ? '✓' : '✗'} #{r.id.slice(3)} {r.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ArgInput({ value, onChange, placeholder, lang }) {
  const parsed = value.trim() ? parseArg(value, lang) : null
  const rows = Math.min(10, Math.max(1, value.split('\n').length))
  return (
    <div className="col" style={{ gap: 2 }}>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {parsed && <span className="faint small">sent as {parsed.kind}{parsed.kind === 'text' ? ' (not valid JSON, so passed as a string)' : ''}</span>}
    </div>
  )
}

function RunResult({ r, isScript, nextSteps, onPipe, openPicker }) {
  const { model, openFile } = useProject()
  const [showOut, setShowOut] = useState(isScript || r.preview == null || !!r.stderr)
  const root = model.root
  const tb = r.error?.traceback || ''
  return (
    <div className="card">
      <div className="spread" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: r.ok ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.07)' }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <b style={{ color: r.ok ? 'var(--ok)' : 'var(--bad)' }}>{r.ok ? '✓ Finished' : r.timedOut ? '✗ Timed out' : '✗ Failed'}</b>
          <span className="muted small">{fmtMs(r.durationMs ?? r.wallMs)}{r.durationMs != null ? ` (process ${fmtMs(r.wallMs)})` : ''}</span>
          {r.type && r.type !== 'None' && <span className="chip mono">{r.type}</span>}
          {r.size > 0 && <span className="faint small">{fmtBytes(r.size)} JSON</span>}
          <span className="faint small">{r.interpreter} · cwd {r.cwd}{r.envFiles?.length ? ` · ${r.envFiles.join(', ')}` : ''}</span>
        </div>
        <div className="row">
          {r.size > 0 && <a className="btn small" href={`/api/runs/${r.id}/value`} download><IconDownload size={13} /> JSON</a>}
          {r.ok && r.preview != null && <button className="small primary" onClick={openPicker}><IconPipe size={13} /> Pipe into…</button>}
        </div>
      </div>
      <div className="card-pad col" style={{ gap: 12 }}>
        {r.error && (
          <div className="col" style={{ gap: 6 }}>
            <div className="notice bad"><b>{r.error.type}</b><span style={{ wordBreak: 'break-word' }}>{r.error.message}</span></div>
            {tb && (
              <pre className="out err">
                {tb.split('\n').map((line, i) => {
                  const m = line.match(/File "([^"]+)", line (\d+)/) || line.match(/\(?(?:file:\/\/)?(\/[^():]+):(\d+):\d+\)?/)
                  if (m && m[1].startsWith(root)) {
                    const rel = m[1].slice(root.length + 1)
                    return <div key={i}><span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openFile(rel, Number(m[2]))}>{line}</span></div>
                  }
                  return <div key={i} style={{ opacity: m ? 0.5 : 1 }}>{line}</div>
                })}
              </pre>
            )}
          </div>
        )}
        {r.ok && !isScript && <DataInspector value={r.preview} profile={r.profile} />}
        {r.ok && nextSteps.length > 0 && r.preview != null && (
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="muted small">Next in the pipeline:</span>
            {nextSteps.map((n) => <button key={n.id} className="small" onClick={() => onPipe(n)}><IconPipe size={12} /> {fnLabel(n)}</button>)}
          </div>
        )}
        {(r.stdout || r.stderr) && (
          <div className="col" style={{ gap: 6 }}>
            <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOut(!showOut)}>{showOut ? '▾' : '▸'} Output ({r.stdout ? `${r.stdout.split('\n').length} lines` : 'stderr only'})</button>
            {showOut && r.stdout && <pre className="out">{r.stdout}</pre>}
            {showOut && r.stderr && <pre className="out err">{r.stderr}</pre>}
          </div>
        )}
        {r.ok && isScript && !r.stdout && <div className="muted small">The script finished without printing anything.</div>}
      </div>
    </div>
  )
}

function PipePicker({ exclude, onPick, onClose }) {
  const { model } = useProject()
  const [q, setQ] = useState('')
  const list = model.functions.filter((f) => f.runnable?.ok && f.runnable.mode !== 'script' && f.id !== exclude && (!q || `${f.qual} ${f.file}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 60)
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="spread" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <b>Send this output to…</b>
        <button className="ghost small" onClick={onClose}><IconX size={13} /></button>
      </div>
      <div style={{ padding: 10 }}><input autoFocus className="mono" style={{ width: '100%' }} placeholder="Function name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="list" style={{ maxHeight: 280, overflow: 'auto' }}>
        {list.map((f) => (
          <div key={f.id} className="list-item" onClick={() => onPick(f)}>
            <code className="grow">{f.qual}({visibleParams(f).map((p) => p.name).join(', ')})</code>
            <span className="faint small">{basename(f.file)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
