// Run with `npm test`. Exercises the analyzer end to end on the bundled demo project,
// plus a few focused extractor and profiler cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProject } from '../server/analyze/index.js'
import { extractJs, regexToPath } from '../server/analyze/js.js'
import { matchRoute, segments } from '../server/analyze/routes.js'
import { profileValue } from '../shared/profile.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEMO = path.join(ROOT, 'examples', 'listings-pipeline')
const { model } = await analyzeProject(DEMO)
const route = (m, p) => model.routes.find((r) => r.method === m && r.path === p)

test('finds Express routes, including ones mounted under a prefix', () => {
  for (const [m, p] of [['GET', '/api/listings'], ['GET', '/api/listings/:id'], ['GET', '/api/stats'], ['POST', '/api/ingest'], ['GET', '/api/admin/health'], ['POST', '/api/admin/reset']]) {
    assert.ok(route(m, p), `missing ${m} ${p}`)
  }
  assert.equal(model.routes.length, 6)
})

test('resolves route handlers, inline and by name', () => {
  const fn = (id) => model.functions.find((f) => f.id === id)
  assert.equal(fn(route('POST', '/api/ingest').handlerId).qual, 'ingestListings')
  assert.equal(fn(route('GET', '/api/listings').handlerId).kind, 'handler')
})

test('links frontend and Python callers to the routes they hit', () => {
  const calls = model.http.filter((h) => h.kind === 'route')
  const byRoute = (r) => calls.filter((h) => h.routeId === r.id).map((h) => h.file)
  assert.deepEqual(byRoute(route('GET', '/api/listings')), ['web/app.js'])
  assert.deepEqual(byRoute(route('POST', '/api/ingest')), ['pipeline/run.py'])
})

test('flags the call to an endpoint that does not exist, and suggests the right one', () => {
  const bad = model.http.filter((h) => h.kind === 'unmatched')
  assert.equal(bad.length, 1)
  assert.equal(bad[0].path, '/api/listing/${id}')
  const suggested = model.routes.find((r) => r.id === bad[0].suggestions[0].routeId)
  assert.equal(suggested.path, '/api/listings/:id')
  assert.equal(model.health.counts.unmatchedCalls, 1)
})

test('classifies data operations and resolves file paths to project files', () => {
  const cats = new Set(model.ops.map((o) => o.cat))
  for (const c of ['http', 'scrape', 'file', 'dom', 'storage']) assert.ok(cats.has(c), `no ${c} ops`)
  const keys = model.resources.map((r) => r.key)
  assert.ok(keys.includes('file:data/listings.json'), keys.join(', '))
  assert.ok(keys.includes('file:pipeline/sample_page.html'))
  assert.ok(keys.includes('http:example.com'))
})

test('builds a call graph across Python modules', () => {
  const main = model.functions.find((f) => f.id === 'pipeline/run.py#<main>')
  const names = main.callees.map((id) => id.split('#')[1])
  for (const n of ['load_sample', 'parse_listings', 'clean_listings', 'summarize', 'push_to_api']) assert.ok(names.includes(n), n)
})

test('flow graph spans entry -> api -> logic -> data, keeping pure pipeline steps', () => {
  const lanes = new Set(model.flow.nodes.map((n) => n.lane))
  assert.deepEqual([...lanes].sort(), ['api', 'data', 'entry', 'logic'])
  const logic = model.flow.nodes.filter((n) => n.lane === 'logic').map((n) => n.path)
  assert.ok(logic.includes('pipeline/clean.py'))
  assert.ok(logic.includes('server/lib/store.js'))
})

test('marks what can run on its own', () => {
  const f = (id) => model.functions.find((x) => x.id === id).runnable
  assert.equal(f('pipeline/clean.py#clean_listings').ok, true)
  assert.equal(f('server/lib/stats.js#computeStats').ok, true)
  assert.equal(f('pipeline/run.py#<main>').mode, 'script')
  assert.equal(f('server/server.js#<module>').ok, false) // starts a server
})

test('js extractor: custom routers, route tables and API wrappers', () => {
  const out = extractJs(`
    const on = (m, p, h) => list.push({ m, p, h })
    on('GET', '/users/self', () => read())
    export const routes = [{ method: 'PUT', pattern: /^\\/courses\\/(\\d+)\\/cover$/, handle: async () => ok() }]
    export async function apiGet(path) { return (await fetch(\`/api\${path}\`)).json() }
    export const load = () => apiGet('/courses')
  `, 'x.js')
  assert.deepEqual(out.routes.map((r) => `${r.method} ${r.path}`), ['GET /users/self', 'PUT /courses/:param/cover'])
  assert.equal(out.http[0].url, '/api${path}')
  assert.deepEqual(out.calls.find((c) => c.name === 'apiGet').args, ['/courses'])
})

test('route matching handles params, prefixes and regex paths', () => {
  const routes = [{ id: 'a', method: 'GET', segs: segments('/courses/:id') }, { id: 'b', method: 'POST', segs: segments('/courses') }]
  assert.equal(matchRoute(routes, 'GET', '/courses/42').route.id, 'a')
  assert.equal(matchRoute(routes, 'GET', '/courses'), null)
  assert.equal(regexToPath('^\\/a\\/(?<id>[^/]+)\\/b\\/?$'), '/a/:id/b')
})

test('profiler flags HTML leftovers, numbers stored as text and duplicates', () => {
  const p = profileValue([
    { title: 'Loft <b>big</b>', price: '$1,200' },
    { title: 'Studio', price: '$900' },
    { title: 'Studio', price: '$900' },
  ])
  const text = p.warnings.map((w) => `${w.column || ''}: ${w.text}`).join(' | ')
  assert.match(text, /title: .*HTML/)
  assert.match(text, /price: numbers stored as text/)
  assert.match(text, /1 duplicate row/)
})

test('story: five plain-English stages in pipeline order', () => {
  const s = model.story
  assert.deepEqual(s.stages.map((x) => x.id), ['collect', 'process', 'store', 'serve', 'show'])
  assert.match(s.summary, /scrapes example\.com, then cleans, summarizes/)
  assert.match(s.summary, /saves the results to data\/listings\.json/)
  const process = s.stages.find((x) => x.id === 'process')
  assert.deepEqual(process.cards.map((c) => c.title).slice(0, 2), ['clean_listings()', 'summarize()'])
  assert.ok(s.caveats.some((c) => c.includes('/api/listing/')), 'broken call is mentioned')
})

test('story: proof plan follows the data and skips anything with side effects', () => {
  const p = model.story.proof
  assert.ok(p.canRun)
  const run = p.steps.filter((x) => x.input).map((x) => [x.label, x.from?.split('#')[1] || null])
  assert.deepEqual(run, [['load_sample', null], ['parse_listings', 'load_sample'], ['clean_listings', 'parse_listings'], ['summarize', 'clean_listings']])
  assert.match(p.steps.find((x) => x.label === 'push_to_api').skip, /changes things/)
  assert.match(p.steps.find((x) => x.label === 'fetch_html').skip, /internet/)
})
