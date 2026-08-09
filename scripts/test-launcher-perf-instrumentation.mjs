#!/usr/bin/env node
/**
 * Contract: launcher perf ring + key path instrumentation for jank diagnosis.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const perf = read('src/workspace/launcher/perf.ts')
const shell = read('src/workspace/pluginShell.ts')
const docs = read('src/workspace/desktopTargets/collectDocumentLauncherItems.ts')
const bridge = read('src/workspace/desktopTargets/collectBridgeLauncherItems.ts')
const session = read('src/workspace/launcher/useLauncherSession.ts')
const rust = read('src-tauri/src/lib.rs')

assert.match(perf, /getLauncherPerfRing|summarizeLauncherPerfRing|dumpLauncherPerfRing/, 'perf ring API required')
assert.match(perf, /installLauncherPerfDebugApi/, 'window.__hivenLauncherPerf installer required')
assert.match(perf, /RING_CAPACITY|pushRing/, 'must keep ring samples even when console off')
assert.match(perf, /forwardLauncherPerfSample|log_launcher_perf_frontend/, 'must forward samples to native file log')
assert.match(perf, /launcher-perf\.ndjson|LAUNCHER_PERF_LOG_HINT/, 'must document log file path')
assert.match(perf, /beginLauncherPerfOpenSession|endLauncherPerfOpenSession/, 'open session openId API required')
assert.match(perf, /openId/, 'forwarded samples must include openId field')

assert.match(shell, /plugin-shell:run/, 'shell.run must log duration')
assert.match(docs, /document-target:provider-list/, 'document collect must time provider.list')
assert.match(docs, /document-target:collect-total/, 'document collect total required')
assert.match(bridge, /bridge-target:collect/, 'bridge collect timing required')
assert.match(session, /session:document-dynamic-partial-apply|session:host-dynamic-partial-apply/, 'session partial apply timing')
assert.match(session, /installLauncherPerfDebugApi/, 'session must install debug API')

assert.match(rust, /spawn_blocking/, 'native shell must use spawn_blocking')
assert.match(rust, /plugin_shell_run_blocking|native:plugin-shell-run/, 'native shell perf label')
assert.match(rust, /append_launcher_perf_file|launcher_perf_log_path/, 'native must append to log file')
assert.match(rust, /launcher-perf\.ndjson/, 'native log path must use launcher-perf.ndjson')
assert.match(rust, /fn\s+launcher_perf_log_file|launcher_perf_log_file,/, 'must expose launcher_perf_log_file command')
// File write must not be gated only by env (always-on diagnosis)
assert.match(
  rust,
  /fn log_launcher_perf_frontend[\s\S]{0,800}append_launcher_perf_file/,
  'frontend logger must always append file before optional stderr gate',
)

console.log('launcher perf instrumentation checks passed')
