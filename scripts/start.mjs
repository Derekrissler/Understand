// `npm start [-- <folder>]`: build the UI if needed, then start the server and open the browser.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'web', 'dist', 'index.html')
const newest = (dir) => {
  let t = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs)
  }
  return t
}
const stale = !fs.existsSync(dist) || newest(path.join(root, 'web', 'src')) > fs.statSync(dist).mtimeMs
if (stale) {
  console.log('Building the UI…')
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const args = process.argv.slice(2)
const child = spawn(process.execPath, [path.join(root, 'server', 'index.js'), ...args], { stdio: 'inherit', env: { ...process.env, UNDERSTAND_OPEN: process.env.UNDERSTAND_OPEN ?? '1' } })
child.on('exit', (code) => process.exit(code ?? 0))
