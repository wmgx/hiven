#!/usr/bin/env node
/**
 * Contract + unit tests for launcher perf analyze/report.
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  analyzeLauncherPerfLog,
  groupLauncherPerfSessions,
  parseLauncherPerfNdjson,
  formatLauncherPerfReport,
} from './lib/launcher-perf-analyze.mjs'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

// ─── Source contracts ────────────────────────────────────────────────────────
const perf = read('src/workspace/launcher/perf.ts')
const app = read('src/App.tsx')
const host = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const pkg = JSON.parse(read('package.json'))
const agents = read('Agents.md')

assert.match(perf, /beginLauncherPerfOpenSession/, 'must expose begin open session')
assert.match(perf, /endLauncherPerfOpenSession/, 'must expose end open session')
assert.match(perf, /openId/, 'samples must carry openId')
assert.match(perf, /open:session-start/, 'session-start marker required')
assert.match(perf, /open:session-end/, 'session-end marker required')
assert.match(perf, /listLauncherPerfOpenSessionsFromRing/, 'ring open list for DevTools')
assert.match(app, /beginLauncherPerfOpenSession/, 'App open path must begin session')
assert.match(host, /endLauncherPerfOpenSession/, 'Host close must end session')
assert.equal(pkg.scripts?.['perf:launcher'], 'node scripts/launcher-perf-report.mjs')
assert.equal(pkg.scripts?.['test:launcher-perf-report'], 'node scripts/test-launcher-perf-report.mjs')
assert.match(agents, /perf:launcher|launcher-perf/, 'Agents.md must document perf CLI for agents')
assert.ok(existsSync(join(root, 'scripts/launcher-perf-report.mjs')))
assert.ok(existsSync(join(root, 'scripts/lib/launcher-perf-analyze.mjs')))

// ─── Analyze unit tests ──────────────────────────────────────────────────────
const fixture = `
{"ts":1000,"source":"native","label":"native:main-thread-open","durationMs":62,"detail":"wasVisible=false"}
{"ts":1100,"source":"frontend","label":"open:session-start","durationMs":null,"openId":"o_test1","details":{"openId":"o_test1","trigger":"hiven://launcher-open"}}
{"ts":1102,"source":"frontend","kind":"latency","label":"open:event-to-store-open","durationMs":2,"openId":"o_test1","slow":false,"jank":false,"details":{"durationMs":2}}
{"ts":1118,"source":"frontend","kind":"latency","label":"open:rehydrate","durationMs":16,"openId":"o_test1","details":{"durationMs":16,"skipped":false}}
{"ts":1200,"source":"frontend","kind":"behavior","label":"behavior:launcher.open","openId":"o_test1","details":{"kind":"behavior"}}
{"ts":1250,"source":"frontend","kind":"behavior","label":"behavior:launcher.query_change","openId":"o_test1","details":{"kind":"behavior","queryLength":3}}
{"ts":1280,"source":"frontend","kind":"behavior","label":"behavior:launcher.item_select","openId":"o_test1","details":{"kind":"behavior","systemKey":"host:x"}}
{"ts":1290,"source":"frontend","kind":"latency","label":"open:event-to-first-paint","durationMs":190,"openId":"o_test1","slow":true,"jank":true,"details":{"durationMs":190}}
{"ts":1295,"source":"frontend","kind":"latency","label":"latency:launcher.item_execute","durationMs":40,"openId":"o_test1","details":{"durationMs":40,"ok":true}}
{"ts":1300,"source":"frontend","kind":"perf","label":"session:rank-items","durationMs":0,"openId":"o_test1","details":{"durationMs":0}}
{"ts":1301,"source":"frontend","kind":"perf","label":"session:rank-items","durationMs":0,"openId":"o_test1","details":{"durationMs":0}}
{"ts":4990,"source":"frontend","kind":"behavior","label":"behavior:launcher.close","openId":"o_test1","details":{"kind":"behavior","reason":"after-action"}}
{"ts":5000,"source":"frontend","label":"open:session-end","durationMs":3900,"openId":"o_test1","details":{"openId":"o_test1","reason":"launcher-closed"}}
{"ts":6000,"source":"frontend","label":"open:session-start","openId":"o_test2","details":{"openId":"o_test2"}}
{"ts":6100,"source":"frontend","label":"open:event-to-first-paint","durationMs":40,"openId":"o_test2","details":{"durationMs":40}}
{"ts":6200,"source":"frontend","label":"open:session-end","openId":"o_test2","details":{"openId":"o_test2"}}
`.trim()

const rows = parseLauncherPerfNdjson(fixture)
assert.ok(rows.length >= 11)

const sessions = groupLauncherPerfSessions(rows)
assert.equal(sessions.length, 2)
assert.equal(sessions[0].openId, 'o_test2') // newest first
assert.equal(sessions[1].openId, 'o_test1')
assert.equal(sessions[1].metrics.firstPaintMs, 190)
assert.equal(sessions[1].metrics.rankItemCount, 2)
assert.equal(sessions[1].metrics.maxItemExecuteMs, 40)
assert.equal(sessions[1].metrics.closeReason, 'after-action')
assert.ok(sessions[1].metrics.behaviorTrail.includes('behavior:launcher.item_select'))
assert.equal(sessions[1].verdict, 'jank')
assert.equal(sessions[0].verdict, 'ok')
assert.equal(sessions[0].metrics.firstPaintMs, 40)

const report = formatLauncherPerfReport(sessions, { last: 2 })
assert.match(report, /o_test1/)
assert.match(report, /first-paint/)
assert.match(report, /jank/)
assert.match(report, /behavior:/)
assert.match(report, /Behavior counts/)

const analyzed = analyzeLauncherPerfLog(rows, { last: 1 })
assert.equal(analyzed.json.last.length, 1)
assert.equal(analyzed.json.last[0].openId, 'o_test2')

// Legacy (no openId) still groups by store-open markers
const legacy = parseLauncherPerfNdjson(`
{"ts":1,"source":"frontend","label":"open:event-to-store-open","durationMs":1}
{"ts":2,"source":"frontend","label":"open:event-to-first-paint","durationMs":300}
{"ts":100,"source":"frontend","label":"open:event-to-store-open","durationMs":1}
{"ts":101,"source":"frontend","label":"open:event-to-first-paint","durationMs":50}
`)
const legacySessions = groupLauncherPerfSessions(legacy)
assert.ok(legacySessions.length >= 2, 'legacy logs should split on store-open')
assert.equal(legacySessions[0].metrics.firstPaintMs, 50)

console.log('launcher perf report checks passed')
