import { useEffect, useMemo, useRef, useState } from 'react'
import { getFile } from '../lib/api.js'
import { shikiLang, tokenize } from '../lib/highlight.js'
import { CAT_COLORS } from '../lib/format.js'

/**
 * Shows part of a file with real syntax highlighting.
 * - start/end: the range (usually a function)
 * - focus: lines to emphasise (blue), e.g. the call that hands off to the next step
 * - ops: [{ line, label, cat }] operation lines (green) with an inline label
 * - fold: in long ranges, show only the interesting lines plus context
 */
export function CodeBlock({ projectId, path, start = 1, end, focus = [], ops = [], fold = true, context = 3, title, actions, tall, scrollTo, maxLines = 400 }) {
  const [file, setFile] = useState(null)
  const [tokens, setTokens] = useState(null)
  const [error, setError] = useState(null)
  const [opened, setOpened] = useState(() => new Set())
  const [all, setAll] = useState(!fold)
  const scrollRef = useRef(null)

  useEffect(() => {
    let live = true
    setTokens(null)
    setError(null)
    getFile(projectId, path)
      .then((f) => {
        if (!live) return
        setFile(f)
        if (f.content != null) tokenize(`${projectId}:${path}`, f.content, shikiLang(f.lang, path)).then((t) => live && setTokens(t))
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [projectId, path])

  const lines = useMemo(() => tokens || (file?.content != null ? file.content.split('\n').map((l) => [{ content: l }]) : null), [tokens, file])
  const focusSet = useMemo(() => new Set(focus.filter(Boolean)), [focus])
  const opByLine = useMemo(() => {
    const m = new Map()
    for (const o of ops) if (!m.has(o.line)) m.set(o.line, o)
    return m
  }, [ops])

  const s = Math.max(1, start || 1)
  const e = lines ? Math.min(lines.length, end || lines.length) : end || s

  // Decide which lines to show: everything, or windows around the interesting ones.
  const segments = useMemo(() => {
    if (!lines) return []
    const total = e - s + 1
    const marks = [...focusSet, ...opByLine.keys()].filter((l) => l >= s && l <= e)
    if (all || total <= 40 || !marks.length) {
      const to = all ? e : Math.min(e, s + maxLines - 1)
      return to < e ? [{ from: s, to }, { gap: true, tail: true, from: to + 1, to: e }] : [{ from: s, to }]
    }
    const keep = new Set()
    for (let i = s; i <= Math.min(e, s + 2); i++) keep.add(i) // signature
    for (const m of marks) for (let i = m - context; i <= m + context; i++) if (i >= s && i <= e) keep.add(i)
    for (let i = Math.max(s, e - 1); i <= e; i++) keep.add(i)
    const out = []
    let cur = null
    for (let i = s; i <= e; i++) {
      const shown = keep.has(i) || [...opened].some(([a, b]) => i >= a && i <= b)
      if (shown) {
        if (cur?.gap) { out.push(cur); cur = null }
        cur = cur || { from: i, to: i }
        cur.to = i
      } else {
        if (cur && !cur.gap) { out.push(cur); cur = null }
        cur = cur || { gap: true, from: i, to: i }
        cur.to = i
      }
    }
    if (cur) out.push(cur)
    return out
  }, [lines, s, e, all, focusSet, opByLine, opened, context, maxLines])

  useEffect(() => {
    if (!scrollTo || !lines || !scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-ln="${scrollTo}"]`)
    if (el) el.scrollIntoView({ block: 'center' })
  }, [scrollTo, lines])

  const head = (
    <div className="code-head">
      <span className="path ellipsis">{title ?? path}</span>
      <span className="faint">{e > s ? `lines ${s}–${e}` : `line ${s}`}</span>
      {file?.virtual && <span className="chip">notebook as Python</span>}
      <span className="grow" />
      {fold && lines && e - s > 40 && (
        <button className="ghost small" onClick={() => setAll((v) => !v)}>
          {all ? 'Fold' : 'Show all'}
        </button>
      )}
      {actions}
    </div>
  )

  if (error) return <div className="code">{head}<div className="card-pad muted small">{error}</div></div>
  if (file?.binary) return <div className="code">{head}<div className="card-pad muted small">Binary file</div></div>
  if (file?.tooLarge) return <div className="code">{head}<div className="card-pad muted small">File too large to show</div></div>
  if (!lines) return <div className="code">{head}<div className="card-pad"><span className="spinner" /></div></div>

  return (
    <div className="code">
      {head}
      <div className={`code-body${tall ? ' tall' : ''}`} ref={scrollRef}>
        {segments.map((seg) =>
          seg.gap ? (
            <div key={`g${seg.from}`} className="code-gap" onClick={() => (seg.tail ? setAll(true) : setOpened((o) => new Set([...o, [seg.from, seg.to]])))}>
              ⋯ {seg.to - seg.from + 1} more line{seg.to === seg.from ? '' : 's'} (click to expand)
            </div>
          ) : (
            Array.from({ length: seg.to - seg.from + 1 }, (_, k) => {
              const ln = seg.from + k
              const toks = lines[ln - 1] || []
              const op = opByLine.get(ln)
              return (
                <div key={ln} data-ln={ln} className={`code-line${focusSet.has(ln) ? ' hl' : op ? ' op' : ''}`}>
                  <span className="ln">{ln}</span>
                  <span className="lc">
                    {toks.map((t, i) => (
                      <span key={i} style={{ color: t.color, fontStyle: t.fontStyle & 1 ? 'italic' : undefined, fontWeight: t.fontStyle & 2 ? 600 : undefined }}>
                        {t.content}
                      </span>
                    ))}
                    {op && (
                      <span className="op-tag" style={{ color: CAT_COLORS[op.cat] }}>
                        ◂ {op.label}
                      </span>
                    )}
                  </span>
                </div>
              )
            })
          ),
        )}
      </div>
    </div>
  )
}
