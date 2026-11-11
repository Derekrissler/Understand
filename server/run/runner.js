// Runs one function (or a whole script) from the analysed project in a child process,
// captures its output and keeps the full result so it can be piped into the next step.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { previewValue, profileValue } from '../../shared/profile.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const TSX = pathToFileURL(require.resolve('tsx')).href
const STUBS = pathToFileURL(path.join(HERE, 'register-stubs.mjs')).href
const OUT_CAP = 256 * 1024

function parseDotenv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
    if (!m) continue
    let v = (m[2] ?? '').trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}

/** Directories from the file up to the project root, closest first. */
function chain(root, file) {
  const out = []
  let d = path.dirname(path.join(root, file))
  while (true) {
    out.push(d)
    if (d === root || !d.startsWith(root) || path.dirname(d) === d) break
    d = path.dirname(d)
  }
  return out
}

function loadEnv(root, file) {
  const env = {}
  const names = []
  for (const d of chain(root, file).reverse()) {
    for (const n of ['.env', '.env.local', '.env.development']) {
      const p = path.join(d, n)
      if (fs.existsSync(p)) {
        Object.assign(env, parseDotenv(fs.readFileSync(p, 'utf8')))
        names.push(path.relative(root, p))
      }
    }
  }
  return { env, files: names }
}

function defaultCwd(root, file) {
  for (const d of chain(root, file)) {
    if (['package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', '.git'].some((m) => fs.existsSync(path.join(d, m)))) return d
  }
  return root
}

function pythonFor(root, file) {
  for (const d of chain(root, file)) {
    for (const v of ['.venv', 'venv', 'env', '.env']) {
      const p = path.join(d, v, 'bin', 'python')
      if (fs.existsSync(p)) return { cmd: p, label: path.relative(root, p) }
    }
  }
  return { cmd: process.env.UNDERSTAND_RUN_PYTHON || 'python3', label: process.env.UNDERSTAND_RUN_PYTHON || 'python3 (no project venv found)' }
}

export class Runner {
  constructor() {
    this.runs = new Map()
    this.seq = 0
  }

  /** Swap {"$run": "run3"} placeholders for the full stored output of that run. */
  resolveRefs(v) {
    if (Array.isArray(v)) return v.map((x) => this.resolveRefs(x))
    if (v && typeof v === 'object') {
      if (typeof v.$run === 'string' && Object.keys(v).length === 1) {
        const r = this.runs.get(v.$run)
        if (!r) throw new Error(`Run ${v.$run} is no longer in memory; run that step again.`)
        return r.value
      }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.resolveRefs(x)]))
    }
    return v
  }

  defaults(project, fn) {
    const cwd = defaultCwd(project.root, fn.file)
    const { files } = loadEnv(project.root, fn.file)
    return {
      cwd: path.relative(project.root, cwd) || '.',
      envFiles: files,
      interpreter: fn.lang === 'python' ? pythonFor(project.root, fn.file).label : `node ${process.version} + tsx`,
    }
  }

  async run(project, fn, { args = [], kwargs = {}, timeoutMs = 30000, useEnv = true, cwd, argv = [] } = {}) {
    if (!fn.runnable?.ok) throw new Error(fn.runnable?.reason || 'This function cannot be run on its own')
    const root = project.root
    const abs = path.join(root, fn.file)
    const id = `run${++this.seq}`
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'understand-run-'))
    const out = path.join(dir, 'out.json')
    const workdir = cwd ? path.resolve(root, cwd) : defaultCwd(root, fn.file)
    if (!workdir.startsWith(root)) throw new Error('Working directory must be inside the project')
    const job = {
      root, file: abs, qual: fn.qual, exported: fn.exported, mode: fn.runnable.mode, cwd: workdir, out, argv,
      args: this.resolveRefs(args), kwargs: this.resolveRefs(kwargs),
    }
    const jobPath = path.join(dir, 'job.json')
    await fsp.writeFile(jobPath, JSON.stringify(job))
    const envFiles = useEnv ? loadEnv(root, fn.file) : { env: {}, files: [] }
    const env = { ...process.env, ...envFiles.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', FORCE_COLOR: '0', NO_COLOR: '1' }

    let cmd, cmdArgs, interpreter
    if (fn.lang === 'python') {
      const py = pythonFor(root, fn.file)
      cmd = py.cmd
      cmdArgs = ['-u', path.join(HERE, 'harness_py.py'), jobPath]
      interpreter = py.label
    } else if (fn.runnable.mode === 'script') {
      cmd = process.execPath
      cmdArgs = ['--import', TSX, '--import', STUBS, abs, ...argv]
      interpreter = `node ${process.version}`
    } else {
      cmd = process.execPath
      cmdArgs = ['--import', TSX, '--import', STUBS, path.join(HERE, 'harness-js.mjs'), jobPath]
      interpreter = `node ${process.version}`
    }

    const started = Date.now()
    const result = await new Promise((resolve) => {
      const child = spawn(cmd, cmdArgs, { cwd: workdir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const cap = (s, c) => (s.length < OUT_CAP ? s + c.toString('utf8') : s)
      child.stdout.on('data', (c) => (stdout = cap(stdout, c)))
      child.stderr.on('data', (c) => (stderr = cap(stderr, c)))
      const timer = setTimeout(() => {
        timedOut = true
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }, timeoutMs)
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ exitCode: -1, stdout, stderr: stderr + String(e.message), timedOut, spawnError: e.message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ exitCode: code, stdout, stderr, timedOut })
      })
    })

    let payload = null
    try {
      payload = JSON.parse(await fsp.readFile(out, 'utf8'))
    } catch {}
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})

    const ok = result.timedOut ? false : payload ? payload.ok : result.exitCode === 0
    const error = result.timedOut
      ? { type: 'Timeout', message: `Stopped after ${Math.round(timeoutMs / 1000)}s. Raise the timeout if this step is slow (scraping, big files).` }
      : payload?.error || (!payload && result.exitCode !== 0 ? { type: result.spawnError ? 'SpawnError' : 'ProcessError', message: result.spawnError || `Exited with code ${result.exitCode}`, traceback: result.stderr.slice(-4000) } : null)
    const value = payload?.value ?? null
    const run = {
      id, fnId: fn.id, label: fn.qual, file: fn.file, startedAt: new Date(started).toISOString(),
      wallMs: Date.now() - started, durationMs: payload?.durationMs ?? null, ok, error, exitCode: payload?.exitCode ?? result.exitCode,
      stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut, type: payload?.type ?? null,
      interpreter: payload?.python ? `Python ${payload.python} (${interpreter})` : interpreter,
      cwd: path.relative(root, workdir) || '.', envFiles: envFiles.files, args, kwargs, mode: fn.runnable.mode, projectId: project.id,
    }
    this.runs.set(id, { ...run, value })
    if (this.runs.size > 60) this.runs.delete(this.runs.keys().next().value)
    return this.summary(id)
  }

  summary(id) {
    const r = this.runs.get(id)
    if (!r) return null
    const { value, ...rest } = r
    return { ...rest, preview: previewValue(value), profile: value == null ? null : profileValue(value), size: value == null ? 0 : JSON.stringify(value).length }
  }

  list(projectId) {
    return [...this.runs.values()].filter((r) => r.projectId === projectId).map(({ value, stdout, stderr, ...r }) => ({ ...r, hasValue: value != null })).reverse()
  }

  rows(id, offset = 0, limit = 200) {
    const r = this.runs.get(id)
    if (!r) return null
    return r.value
  }
}
