#!/usr/bin/env node
// Headless analysis: `npm run analyze -- <folder> [--json]`
import path from 'node:path'
import { analyzeProject } from './analyze/index.js'

const args = process.argv.slice(2)
const target = path.resolve(args.find((a) => !a.startsWith('--')) || '.')
const { model } = await analyzeProject(target, { onProgress: (m) => process.stderr.write(`· ${m}\n`) })

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(model, null, 2))
  process.exit(0)
}

const fn = new Map(model.functions.map((f) => [f.id, f]))
const t = model.totals
console.log(`\n${model.name}: ${t.files} files, ${t.codeFiles} parsed, ${t.loc} LOC, ${t.functions} functions (${model.durationMs} ms)`)
console.log('\nStack:', model.stack.technologies.filter((x) => x.known).map((x) => x.label).join(', ') || '(none detected)')
console.log('Languages:', model.stack.languages.map((l) => `${l.lang} ${l.loc}`).join(', '))
console.log(`\nRoutes (${model.routes.length}):`)
for (const r of model.routes.slice(0, 40)) console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(36)} ${r.file}:${r.line}  -> ${r.handlerId ? fn.get(r.handlerId)?.qual : '(handler not resolved)'}  [${r.callerIds.length} caller(s)]`)
console.log(`\nClient calls (${model.http.length}):`)
for (const h of model.http.slice(0, 40)) console.log(`  ${h.kind.padEnd(10)} ${h.method.padEnd(6)} ${String(h.resolvedUrl ?? '(dynamic)').padEnd(44)} ${h.file}:${h.line}${h.routeId ? '  => ' + h.routeId : ''}`)
const cats = {}
for (const o of model.ops) cats[o.cat] = (cats[o.cat] || 0) + 1
console.log('\nOperations:', Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(', '))
console.log('Resources:', model.resources.map((r) => r.label).join(', '))
const lanes = {}
for (const n of model.flow.nodes) lanes[n.lane] = (lanes[n.lane] || 0) + 1
console.log(`\nFlow: ${model.flow.nodes.length} nodes (${Object.entries(lanes).map(([k, v]) => `${k} ${v}`).join(', ')}), ${model.flow.edges.length} edges`)
console.log('\nRead first:')
for (const r of model.insights.readFirst.slice(0, 8)) console.log(`  ${fn.get(r.fnId).qual.padEnd(28)} ${fn.get(r.fnId).file}  (${r.reasons.join('; ')})`)
console.log('\nHealth:', Object.entries(model.health.counts).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' '))
