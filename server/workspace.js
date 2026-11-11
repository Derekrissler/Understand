// Projects the app knows about: opened from a local path or uploaded through the browser.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { analyzeProject } from './analyze/index.js'
import { makeTracer } from './analyze/trace.js'

export class Workspace {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.uploadsDir = path.join(dataDir, 'uploads')
    this.recentFile = path.join(dataDir, 'recent.json')
    this.projects = new Map()
    this.uploads = new Map()
  }

  idFor(root) {
    return crypto.createHash('sha1').update(root).digest('hex').slice(0, 10)
  }

  async recent() {
    try {
      return JSON.parse(await fs.readFile(this.recentFile, 'utf8'))
    } catch {
      return []
    }
  }

  async remember(entry) {
    const list = (await this.recent()).filter((e) => e.id !== entry.id)
    list.unshift(entry)
    await fs.mkdir(this.dataDir, { recursive: true })
    await fs.writeFile(this.recentFile, JSON.stringify(list.slice(0, 20), null, 2))
  }

  async open(root, { name, source = 'path' } = {}) {
    const abs = path.resolve(root.replace(/^~(?=$|\/)/, process.env.HOME || '~'))
    const id = this.idFor(abs)
    const { model, internal } = await analyzeProject(abs, { name })
    const project = { id, root: abs, source, model: { ...model, id, source }, internal, trace: makeTracer(model, internal) }
    this.projects.set(id, project)
    await this.remember({ id, root: abs, name: model.name, source, files: model.totals.files, loc: model.totals.loc, openedAt: new Date().toISOString() })
    return project
  }

  async get(id) {
    if (this.projects.has(id)) return this.projects.get(id)
    const entry = (await this.recent()).find((e) => e.id === id)
    if (!entry) return null
    return this.open(entry.root, { name: entry.name, source: entry.source })
  }

  async reanalyze(id) {
    const p = await this.get(id)
    if (!p) return null
    return this.open(p.root, { name: p.model.name, source: p.source })
  }

  // ---- uploads: the browser sends the folder in batches ----
  async startUpload(name) {
    const id = crypto.randomBytes(6).toString('hex')
    const safe = String(name || 'project').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'project'
    const dir = path.join(this.uploadsDir, `${safe}-${id}`)
    await fs.mkdir(dir, { recursive: true })
    this.uploads.set(id, { dir, name: safe, count: 0 })
    return { uploadId: id }
  }

  async addUploadFile(uploadId, relPath, buffer) {
    const up = this.uploads.get(uploadId)
    if (!up) throw new Error('Unknown upload')
    const clean = path.posix.normalize(String(relPath).replace(/\\/g, '/')).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '')
    const target = path.join(up.dir, clean)
    if (!target.startsWith(up.dir + path.sep)) throw new Error(`Bad path: ${relPath}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, buffer)
    up.count++
  }

  async finishUpload(uploadId) {
    const up = this.uploads.get(uploadId)
    if (!up) throw new Error('Unknown upload')
    this.uploads.delete(uploadId)
    // the browser includes the folder name as the first path segment; analyse inside it
    const entries = await fs.readdir(up.dir, { withFileTypes: true })
    const root = entries.length === 1 && entries[0].isDirectory() ? path.join(up.dir, entries[0].name) : up.dir
    return this.open(root, { name: entries.length === 1 ? entries[0].name : up.name, source: 'upload' })
  }
}
