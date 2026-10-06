#!/usr/bin/env node
/**
 * Contract: product telemetry (behavior + latency) on always-on NDJSON.
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const events = read('src/workspace/telemetry/events.ts')
const track = read('src/workspace/telemetry/track.ts')
const index = read('src/workspace/telemetry/index.ts')
const perf = read('src/workspace/launcher/perf.ts')
const controller = read('src/workspace/launcher/controller.ts')
const host = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const clipboard = read('src/launcher/clipboard/useClipboardObjectBlock.ts')
const selection = read('src/components/launcher/useGlobalLauncherSelectionController.ts')
const pkg = JSON.parse(read('package.json'))
const agents = read('Agents.md')
const analyze = read('scripts/lib/launcher-perf-analyze.mjs')

assert.match(events, /TelemetryEvents/, 'event catalog required')
assert.match(events, /behavior:launcher\.open/, 'open behavior event')
assert.match(events, /latency:launcher\.item_execute/, 'execute latency event')
assert.match(events, /behavior:launcher\.close/, 'close behavior event')
assert.match(track, /trackBehavior/, 'trackBehavior API')
assert.match(track, /trackLatency|trackLatencyFrom/, 'latency API')
assert.match(track, /measureLatency/, 'measureLatency API')
assert.match(track, /createDebouncedTracker/, 'debounced typing tracker')
assert.match(index, /TelemetryEvents/, 'public export')
assert.match(perf, /kind\?:/, 'sample kind field')
assert.match(perf, /kind: sample\.kind/, 'forward kind to NDJSON')

assert.match(controller, /TelemetryEvents\.launcherItemSelect/, 'controller select behavior')
assert.match(controller, /TelemetryEvents\.launcherItemExecute/, 'controller execute latency')
assert.match(controller, /TelemetryEvents\.launcherSubmitInput/, 'submit input behavior')
assert.match(controller, /TelemetryEvents\.launcherBack/, 'back behavior')

assert.match(host, /TelemetryEvents\.launcherClose/, 'close reason behavior')
assert.match(host, /TelemetryEvents\.launcherQueryChange/, 'query change behavior')
assert.match(host, /TelemetryEvents\.objectActionExecute/, 'object action behavior')
assert.match(host, /TelemetryEvents\.pasteText/, 'paste behavior')

assert.match(clipboard, /TelemetryEvents\.clipboardBlockAttach/, 'clipboard attach')
assert.match(clipboard, /TelemetryEvents\.clipboardBlockRemove/, 'clipboard remove')
assert.match(
  clipboard,
  /const raf1 = requestAnimationFrame\(\(\) => \{\s*timer = window\.setTimeout\(\(\) => \{\s*void readAfterFirstPaint\(\)/,
  'clipboard read must start in a task after the first render opportunity',
)
assert.match(
  host,
  /const raf = requestAnimationFrame\(\(\) => \{\s*paintTimer = window\.setTimeout\(/,
  'first-paint telemetry must not wait for a throttled second animation frame',
)
assert.match(selection, /TelemetryEvents\.surfaceOpen/, 'surface open behavior')
assert.match(track, /track\.cancel/, 'debounced behavior must be cancellable on close')
assert.match(host, /trackQueryChangeRef\.current\.cancel\(\)/, 'close must cancel pending query telemetry')

assert.equal(pkg.scripts?.telemetry, 'node scripts/launcher-perf-report.mjs')
assert.equal(pkg.scripts?.['test:telemetry'], 'node scripts/test-telemetry-contract.mjs')
assert.match(agents, /telemetry|behavior:launcher/, 'Agents.md documents telemetry')
assert.match(analyze, /behaviorTrail|Behavior counts/, 'report includes behavior funnel')

assert.ok(existsSync(join(root, 'src/workspace/telemetry/index.ts')))
assert.ok(existsSync(join(root, 'doc/launcher-perf-telemetry.md')))

console.log('telemetry contract checks passed')
