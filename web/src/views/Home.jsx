import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Logo, IconFolder, IconArrow } from '../lib/icons.jsx'
import { fmtNum, timeAgo } from '../lib/format.js'

// Folders the browser should never upload: dependencies, build output, VCS, caches.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output', 'target', '.gradle', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.idea', '.vscode', 'coverage', '.cache', '.turbo', '.parcel-cache', 'Pods', 'DerivedData', '.dart_tool', '.expo', '.terraform', 'bower_components', 'vendor'])
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|icns|bmp|tiff|psd|mp3|mp4|mov|wav|avi|webm|ogg|zip|gz|tgz|7z|rar|jar|war|class|so|dylib|dll|exe|wasm|pyc|pdf|docx?|xlsx?|pptx?|sqlite3?|db|pkl|parquet|h5|npy|npz|pt|onnx|woff2?|ttf|otf|eot|DS_Store|lock)$/i
const MAX_FILE = 4 * 1024 * 1024

const keep = (path, size) => {
  const parts = path.split('/')
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false
  if (SKIP_EXT.test(path) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)) return false
  return size <= MAX_FILE
}

async function filesFromDrop(items) {
  const out = []
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej))
      const p = prefix + entry.name
      if (keep(p, f.size)) out.push({ file: f, path: p })
    } else if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name) && prefix) return
      const reader = entry.createReader()
      let batch
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej))
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`)
      } while (batch.length)
    }
  }
  for (const it of items) if (it) await walk(it, '')
  return out
}

export function Home() {
  const [recent, setRecent] = useState([])
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [over, setOver] = useState(false)
  const [progress, setProgress] = useState(null)
  const [demoPath, setDemoPath] = useState(null)
  const input = useRef(null)

  useEffect(() => {
    api('/api/projects').then((r) => setRecent(r.recent)).catch(() => {})
    api('/api/health').then((h) => setDemoPath(h.demoPath)).catch(() => {})
  }, [])

  const openPath = async (p) => {
    setError(null)
    setBusy('Analysing…')
    try {
      const r = await api('/api/projects/open', { method: 'POST', body: { path: p } })
      location.hash = `#/p/${r.id}/pipeline`
    } catch (e) {
      setError(e.message)
      setBusy(null)
    }
  }

  const upload = async (files) => {
    setError(null)
    if (!files.length) return setError('Nothing to upload: the folder was empty after skipping dependencies and build output.')
    const name = files[0].path.split('/')[0] || 'project'
    setBusy(`Uploading ${files.length} files…`)
    try {
      const { uploadId } = await api('/api/uploads', { method: 'POST', body: { name } })
      let done = 0
      let batch = []
      let bytes = 0
      const flush = async () => {
        if (!batch.length) return
        const fd = new FormData()
        for (const f of batch) fd.append('files', f.file, f.path)
        await api(`/api/uploads/${uploadId}/files`, { method: 'POST', body: fd })
        done += batch.length
        setProgress(done / files.length)
        batch = []
        bytes = 0
      }
      for (const f of files) {
        batch.push(f)
        bytes += f.file.size
        if (batch.length >= 150 || bytes > 12 * 1024 * 1024) await flush()
      }
      await flush()
      setBusy('Analysing…')
      const r = await api(`/api/uploads/${uploadId}/finish`, { method: 'POST' })
      location.hash = `#/p/${r.id}/pipeline`
    } catch (e) {
      setError(e.message)
      setBusy(null)
      setProgress(null)
    }
  }

  const onPick = (e) => {
    const list = [...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })).filter((f) => keep(f.path, f.file.size))
    upload(list)
    e.target.value = ''
  }
  const onDrop = async (e) => {
    e.preventDefault()
    setOver(false)
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.())
    setBusy('Reading folder…')
    upload(await filesFromDrop(items))
  }

  return (
    <div className="home">
      <div className="home-inner">
        <div className="hero">
          <div className="row" style={{ gap: 12, marginBottom: 18 }}>
            <span className="brand-mark" style={{ width: 36, height: 36 }}><Logo size={24} /></span>
            <span style={{ fontWeight: 700, fontSize: 18 }}>Understand</span>
          </div>
          <h1>Understand what a big, vibecoded project actually does.</h1>
          <p>Get the pipeline in a few plain-English steps, from where the data comes from to where people see it, with the key code as evidence and real data runs as proof.</p>
        </div>

        <div className="two-col">
          <div
            className={`card drop${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={() => !busy && input.current?.click()}
          >
            <IconFolder size={28} />
            <h2>Drop a project folder</h2>
            <p className="muted small">or click to choose one. Skips node_modules, .git, build output and virtualenvs.</p>
            <input ref={input} type="file" webkitdirectory="" directory="" multiple hidden onChange={onPick} />
            {progress != null && <div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          </div>
          <div className="card card-pad col" style={{ gap: 12 }}>
            <h2>Open a folder on this computer</h2>
            <p className="muted small">Best for the Test bench: code runs in place, with the project's own installed packages and virtualenv.</p>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (path.trim()) openPath(path.trim()) }}>
              <input className="grow mono" placeholder="~/Projects/my-app" value={path} onChange={(e) => setPath(e.target.value)} />
              <button className="primary" disabled={!path.trim() || !!busy}>Open <IconArrow size={14} /></button>
            </form>
            {demoPath && (
              <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => openPath(demoPath)} disabled={!!busy}>
                Try the demo: a scrape → clean → API pipeline with two planted bugs
              </button>
            )}
          </div>
        </div>

        {busy && <div className="row muted"><span className="spinner" /> {busy}</div>}
        {error && <div className="notice bad"><span>⚠</span><div>{error}</div></div>}

        {recent.length > 0 && (
          <div className="card">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><h2>Recent</h2></div>
            <div className="list">
              {recent.map((r) => (
                <div key={r.id} className="list-item" onClick={() => (location.hash = `#/p/${r.id}/pipeline`)}>
                  <IconFolder size={15} />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="faint small mono ellipsis">{r.source === 'upload' ? 'uploaded copy' : r.root}</div>
                  </div>
                  <span className="faint small">{fmtNum(r.files)} files · {fmtNum(r.loc)} lines · {timeAgo(r.openedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="features">
          <div className="feature"><h3>How it works</h3><p>Collect → process → store → serve → show, in plain English, with the code lines that prove each step.</p></div>
          <div className="feature"><h3>Prove it</h3><p>Run the pipeline on safe input and see the real data at every step, or check that the API returns real records.</p></div>
          <div className="feature"><h3>Talking points</h3><p>A short script you can copy to explain the project, backed by what the runs showed.</p></div>
        </div>
      </div>
    </div>
  )
}
