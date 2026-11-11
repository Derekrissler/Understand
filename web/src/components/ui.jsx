import { useState } from 'react'
import { CAT_COLORS, CAT_SHORT, ROLE_COLORS } from '../lib/format.js'
import { IconCopy } from '../lib/icons.jsx'

export function CatChip({ cat, count, label, onClick }) {
  return (
    <span className={`chip${onClick ? ' click' : ''}`} onClick={onClick} title={label || cat}>
      <span className="dot" style={{ background: CAT_COLORS[cat] || 'var(--muted)' }} />
      {label || CAT_SHORT[cat] || cat}
      {count != null && count > 1 && <span className="faint">×{count}</span>}
    </span>
  )
}

export function OpBadges({ ops = {}, max = 5 }) {
  const entries = Object.entries(ops).sort((a, b) => b[1] - a[1])
  return (
    <div className="badges">
      {entries.slice(0, max).map(([cat, n]) => (
        <span key={cat} className="cat" style={{ background: CAT_COLORS[cat] || '#94a3b8' }} title={`${n} ${cat} operation${n > 1 ? 's' : ''}`}>
          {CAT_SHORT[cat] || cat}{n > 1 ? ` ${n}` : ''}
        </span>
      ))}
      {entries.length > max && <span className="faint small">+{entries.length - max}</span>}
    </div>
  )
}

export const Method = ({ m }) => <span className={`method ${m}`}>{m}</span>

export function RoleBadge({ role }) {
  if (!role) return null
  return (
    <span className="chip" style={{ color: ROLE_COLORS[role], borderColor: 'transparent', background: 'var(--panel-3)' }}>
      {role}
    </span>
  )
}

export function CopyButton({ text, label }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="ghost small"
      title="Copy"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
    >
      <IconCopy size={13} /> {done ? 'Copied' : label || ''}
    </button>
  )
}

export function Section({ title, hint, actions, children, pad = true }) {
  return (
    <section className="card">
      <div className="spread" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <h2>{title}</h2>
          {hint && <div className="muted small" style={{ marginTop: 2 }}>{hint}</div>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  )
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="row muted" style={{ padding: 16 }}>
      <span className="spinner" /> {label}
    </div>
  )
}
