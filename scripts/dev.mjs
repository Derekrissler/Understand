// `npm run dev [-- <folder>]`: API server with --watch plus the Vite dev server (hot reload).
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const procs = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=shared', path.join(root, 'server', 'index.js'), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, UNDERSTAND_UI: 'http://localhost:5173' } }),
  spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit' }),
]
const stop = () => { for (const p of procs) p.kill() ; process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', (code) => { if (code) stop() })
