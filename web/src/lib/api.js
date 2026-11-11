// Every state-changing call carries X-Understand: the server refuses requests without it.
const HEADERS = { 'X-Understand': '1' }

export async function api(path, { method = 'GET', body } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const r = await fetch(path, {
    method,
    headers: isForm ? HEADERS : { ...HEADERS, 'Content-Type': 'application/json' },
    body: isForm ? body : body != null ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`)
  return j
}

const fileCache = new Map()
export function getFile(projectId, path) {
  const key = `${projectId}:${path}`
  if (!fileCache.has(key)) {
    const p = api(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`)
    p.catch(() => fileCache.delete(key))
    fileCache.set(key, p)
  }
  return fileCache.get(key)
}
export function clearFileCache() {
  fileCache.clear()
}
