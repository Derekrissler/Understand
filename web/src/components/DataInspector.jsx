import { useMemo, useState } from 'react'
import { findRecords, profileValue } from '../../../shared/profile.js'
import { fmtNum } from '../lib/format.js'

const HTML_TAG = /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>|&(amp|nbsp|lt|gt|quot|#\d+);/i
const NUMERIC_TEXT = /^\s*[-+]?[$€£¥]?\s*[-+]?\d[\d,]*(\.\d+)?\s*(%|k|m|usd)?\s*$/i

/** "Is this the data I expect?": table, per-column profile and warnings for any value. */
export function DataInspector({ value, profile: given, emptyLabel = 'No value', compact }) {
  const profile = useMemo(() => given ?? (value === undefined ? null : profileValue(value)), [given, value])
  const found = useMemo(() => (value == null ? null : findRecords(value)), [value])
  const hasTable = !!found && found.records.length > 0
  const [tab, setTab] = useState(null)
  const active = tab || (hasTable ? 'table' : 'json')

  if (value === undefined || value === null) {
    return <div className="muted small">{value === null ? 'Returned nothing (None / null / undefined).' : emptyLabel}</div>
  }
  if (typeof value === 'string' && !hasTable) {
    return (
      <div className="inspector">
        <div className="muted small">Text, {fmtNum(value.length)} characters{HTML_TAG.test(value) ? ' · looks like HTML' : ''}</div>
        <pre className="out">{value.length > 20000 ? value.slice(0, 20000) + '\n… (truncated)' : value}</pre>
      </div>
    )
  }
  if (typeof value !== 'object') {
    return <pre className="out">{String(value)}</pre>
  }

  const warn = profile?.warnings?.filter((w) => w.level === 'warn') || []
  const kindLabel = profile?.kind === 'dataframe' ? 'DataFrame' : profile?.kind === 'records' ? 'records' : profile?.kind === 'list' ? 'list' : Array.isArray(value) ? 'array' : 'object'
  return (
    <div className="inspector">
      <div className="row wrap" style={{ gap: 6 }}>
        {profile?.rows != null && (
          <span className="chip accent">
            {fmtNum(profile.rows)} row{profile.rows === 1 ? '' : 's'} · {profile.columns?.length || 0} column{profile.columns?.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="chip">{kindLabel}</span>
        {found && found.path !== '$' && <span className="chip mono" title="Where the table was found inside the value">{found.path.replace(/^\$\.?/, '')}</span>}
        {value?.__type === 'DataFrame' && value.shape && <span className="chip">shape {value.shape.join(' × ')}</span>}
        {value?.__type === 'Response' && <span className="chip">HTTP {value.status}</span>}
        {profile?.duplicates > 0 && <span className="chip warn">{profile.duplicates} duplicate rows</span>}
      </div>
      {profile?.rows != null && !compact && (
        warn.length ? (
          <div className="notice warn">
            <span>⚠</span>
            <div className="col" style={{ gap: 2 }}>
              <b>Things that look off</b>
              {warn.slice(0, 8).map((w, i) => (
                <span key={i}>{w.column ? <code>{w.column}</code> : null}{w.column ? ': ' : ''}{w.text}</span>
              ))}
            </div>
          </div>
        ) : profile.rows > 0 ? (
          <div className="notice ok"><span>✓</span><span>No obvious problems across {fmtNum(profile.rows)} rows: no empty columns, mixed types, duplicates or HTML leftovers.</span></div>
        ) : (
          <div className="notice warn"><span>⚠</span><span>The step returned an empty list.</span></div>
        )
      )}
      <div className="tabs">
        {hasTable && <button className={active === 'table' ? 'on' : ''} onClick={() => setTab('table')}>Table</button>}
        {profile?.columns && <button className={active === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>Columns</button>}
        <button className={active === 'json' ? 'on' : ''} onClick={() => setTab('json')}>JSON</button>
      </div>
      {active === 'table' && hasTable && <RecordsTable records={found.records} profile={profile} />}
      {active === 'profile' && profile?.columns && <ProfileGrid profile={profile} />}
      {active === 'json' && (
        <div className="code card-pad" style={{ maxHeight: 460, overflow: 'auto', padding: 12 }}>
          <JsonTree value={value} />
        </div>
      )}
    </div>
  )
}

function cellClass(v) {
  if (v === null || v === undefined || v === '') return 'v-null'
  if (typeof v === 'number') return 'v-num'
  if (typeof v === 'boolean') return 'v-bool'
  if (typeof v === 'object') return 'v-obj'
  return ''
}
function cellText(v) {
  if (v === null || v === undefined) return 'null'
  if (v === '') return '""'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function RecordsTable({ records, profile }) {
  const cols = useMemo(() => {
    if (profile?.columns?.length) return profile.columns.map((c) => c.name)
    const s = new Set()
    for (const r of records.slice(0, 100)) for (const k of Object.keys(r)) s.add(k)
    return [...s]
  }, [records, profile])
  const flags = useMemo(() => {
    const m = {}
    for (const c of profile?.columns || []) {
      const t = c.flags.map((f) => f.text).join(' ')
      m[c.name] = { html: /HTML/.test(t), numText: /numbers stored as text/.test(t), ws: /whitespace/.test(t) }
    }
    return m
  }, [profile])
  const rows = records.filter((r) => !r.__truncated).slice(0, 300)
  const isFlag = (col, v) => {
    const f = flags[col]
    if (!f || typeof v !== 'string') return false
    return (f.html && HTML_TAG.test(v)) || (f.numText && NUMERIC_TEXT.test(v)) || (f.ws && (v !== v.trim() || /\n/.test(v)))
  }
  const total = profile?.rows ?? records.length
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="dtable-wrap">
        <table className="dtable">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              {cols.map((c) => (
                <th key={c}>{c}{flags[c] && (flags[c].html || flags[c].numText) ? <span style={{ color: 'var(--warn)' }}> ⚠</span> : null}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="idx">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c} className={`${cellClass(r[c])}${isFlag(c, r[c]) ? ' v-flag' : ''}`} title={cellText(r[c])}>
                    {cellText(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && <div className="faint small">Showing {rows.length} of {fmtNum(total)} rows. Download the full result from the run header.</div>}
    </div>
  )
}

const TYPE_COLORS = { string: '#a5d6ff', number: '#79c0ff', boolean: '#d2a8ff', object: '#8b93a7', array: '#c3c8d4', null: '#3a4255' }

function ProfileGrid({ profile }) {
  return (
    <div className="profile-grid">
      {profile.columns.map((c) => {
        const total = Object.values(c.types).reduce((a, b) => a + b, 0) || 1
        const warn = c.flags.some((f) => f.level === 'warn')
        return (
          <div key={c.name} className={`pcol${warn ? ' flagged' : ''}`}>
            <div className="spread">
              <code style={{ fontWeight: 600 }} className="ellipsis">{c.name}</code>
              <span className="faint small">{c.dateLike ? 'dates' : Object.entries(c.types).filter(([t]) => t !== 'null').map(([t]) => t).join(' / ') || 'empty'}</span>
            </div>
            <div className="bar" title={Object.entries(c.types).map(([t, n]) => `${t}: ${n}`).join(', ')}>
              {Object.entries(c.types).map(([t, n]) => <span key={t} style={{ width: `${(n / total) * 100}%`, background: TYPE_COLORS[t] }} />)}
            </div>
            <div className="small muted">
              {Math.round(((total - c.empty) / total) * 100)}% filled · {fmtNum(c.unique)}{c.uniqueCapped ? '+' : ''} unique
            </div>
            {c.number && <div className="small mono">min {round(c.number.min)} · max {round(c.number.max)} · avg {round(c.number.mean)}</div>}
            {c.text && !c.number && <div className="small faint">length {c.text.minLen}–{c.text.maxLen}</div>}
            {c.samples.length > 0 && <div className="small mono ellipsis faint" title={c.samples.join(' | ')}>e.g. {c.samples.map((s) => JSON.stringify(s)).join(', ')}</div>}
            {c.flags.map((f, i) => (
              <div key={i} className="small" style={{ color: f.level === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>{f.level === 'warn' ? '⚠ ' : ''}{f.text}</div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
const round = (n) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : Number(n.toFixed(2)))

export function JsonTree({ value, depth = 0, name, last = true }) {
  const [open, setOpen] = useState(depth < 2)
  const key = name != null ? <><span className="k">{JSON.stringify(name)}</span>: </> : null
  const comma = last ? '' : ','
  if (value === null || typeof value !== 'object') {
    const cls = value === null ? 'z' : typeof value === 'string' ? 's' : typeof value === 'number' ? 'n' : 'b'
    const text = typeof value === 'string' && value.length > 500 ? JSON.stringify(value.slice(0, 500)) + '…' : JSON.stringify(value)
    return <div className="json">{key}<span className={cls}>{text}</span>{comma}</div>
  }
  if (value.__truncated) return <div className="json z">… {value.total ? `${value.total - (value.shown || 0)} more items` : 'truncated'}</div>
  const isArr = Array.isArray(value)
  const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value)
  const [o, c] = isArr ? ['[', ']'] : ['{', '}']
  if (!entries.length) return <div className="json">{key}{o}{c}{comma}</div>
  return (
    <div className="json">
      <span className="tog" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} </span>
      {key}{o}
      {!open && <span className="tog" onClick={() => setOpen(true)}> {isArr ? `${entries.length} items` : `${entries.length} keys`} </span>}
      {open && (
        <div className="ind">
          {entries.slice(0, 200).map(([k, v], i) => (
            <JsonTree key={k} value={v} depth={depth + 1} name={isArr ? null : k} last={i === Math.min(entries.length, 200) - 1} />
          ))}
          {entries.length > 200 && <div className="z">… {entries.length - 200} more</div>}
        </div>
      )}
      {c}{comma}
    </div>
  )
}
