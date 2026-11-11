import fs from 'node:fs/promises'
import path from 'node:path'
import ignore from 'ignore'

export const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'typescript',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro',
  '.py': 'python', '.ipynb': 'notebook',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala', '.groovy': 'groovy', '.gradle': 'gradle',
  '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php', '.cs': 'csharp', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.m': 'objective-c', '.dart': 'dart',
  '.lua': 'lua', '.ex': 'elixir', '.exs': 'elixir', '.r': 'r', '.ino': 'arduino',
  '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
  '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'toml', '.xml': 'xml', '.md': 'markdown',
  '.sql': 'sql', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell', '.ps1': 'powershell', '.bat': 'batch',
  '.properties': 'properties', '.env': 'dotenv', '.txt': 'text', '.csv': 'csv',
}

/** Languages that count as "code" in the stack breakdown (vs. config, docs, data). */
export const CODE_LANGS = new Set([
  'javascript', 'typescript', 'vue', 'svelte', 'astro', 'python', 'notebook', 'java', 'kotlin', 'scala',
  'groovy', 'go', 'rust', 'ruby', 'php', 'csharp', 'swift', 'c', 'cpp', 'objective-c', 'dart', 'lua',
  'elixir', 'r', 'arduino', 'html', 'css', 'scss', 'less', 'sql', 'shell', 'powershell', 'batch',
])

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.tiff', '.psd', '.svgz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.jar', '.war', '.class', '.so', '.dylib', '.dll', '.exe', '.bin', '.o', '.a', '.wasm', '.pyc',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.mp3', '.mp4', '.mov', '.wav', '.avi',
  '.webm', '.ogg', '.sqlite', '.sqlite3', '.db', '.pkl', '.pickle', '.parquet', '.feather', '.h5',
  '.npy', '.npz', '.pt', '.onnx', '.keystore', '.p12', '.DS_Store',
])

// Folders and files that are never worth analysing.
const ALWAYS_IGNORE = [
  'node_modules/', '.git/', '.hg/', '.svn/', 'dist/', 'build/', 'out/', '.next/', '.nuxt/', '.svelte-kit/',
  '.output/', '.vercel/', '.netlify/', 'target/', '.gradle/', '__pycache__/', '.venv/', 'venv/', '.tox/',
  '.mypy_cache/', '.pytest_cache/', '.ruff_cache/', '.idea/', '.vscode/', 'coverage/', '.cache/', '.turbo/',
  '.parcel-cache/', 'Pods/', 'DerivedData/', '.dart_tool/', '.expo/', '.angular/', '.terraform/',
  '**/bin/main/', '**/bin/test/', '.workspaces/', '.DS_Store',
  '*.min.js', '*.min.css', '*.map', '*.pyc', '*.class',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'poetry.lock', 'Cargo.lock', 'Pipfile.lock', 'composer.lock',
]

export async function walkProject(root, { maxFiles = 20000 } = {}) {
  const base = ignore().add(ALWAYS_IGNORE)
  const files = []
  let ignored = 0
  let truncated = false

  async function visit(dirAbs, dirRel, matchers) {
    let ig = null
    try {
      ig = ignore().add(await fs.readFile(path.join(dirAbs, '.gitignore'), 'utf8'))
    } catch {}
    const ms = ig ? [...matchers, { rel: dirRel, ig }] : matchers
    let entries
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    if (dirRel && entries.some((e) => e.name === 'pyvenv.cfg')) return // a virtualenv
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (files.length >= maxFiles) { truncated = true; return }
      if (e.isSymbolicLink()) continue
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name
      const isDir = e.isDirectory()
      const probe = isDir ? `${rel}/` : rel
      if (base.ignores(probe)) { ignored++; continue }
      const hit = ms.some((m) => {
        const r = m.rel ? path.posix.relative(m.rel, rel) : rel
        return r && !r.startsWith('..') && m.ig.ignores(isDir ? `${r}/` : r)
      })
      if (hit) { ignored++; continue }
      if (isDir) await visit(path.join(dirAbs, e.name), rel, ms)
      else if (e.isFile()) files.push({ path: rel, abs: path.join(dirAbs, e.name) })
    }
  }

  await visit(root, '', [])

  await Promise.all(
    files.map(async (f) => {
      const ext = extOf(f.path)
      f.ext = ext
      f.lang = LANG_BY_EXT[ext] || (path.posix.basename(f.path).startsWith('.env') ? 'dotenv' : null)
      if (/(^|\/)(Dockerfile|Containerfile)[^/]*$/.test(f.path)) f.lang = 'docker'
      if (/(^|\/)(Makefile|Procfile)$/.test(f.path)) f.lang = 'config'
      try {
        f.size = (await fs.stat(f.abs)).size
      } catch {
        f.size = 0
      }
      f.binary = BINARY_EXT.has(ext)
    }),
  )
  return { files, ignored, truncated }
}

export function extOf(p) {
  const b = path.posix.basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

export async function readText(f, maxBytes = 1_500_000) {
  if (f.binary || f.size > maxBytes) return null
  try {
    const buf = await fs.readFile(f.abs)
    // NUL byte in the first 8KB => binary
    const head = buf.subarray(0, 8192)
    if (head.includes(0)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}
