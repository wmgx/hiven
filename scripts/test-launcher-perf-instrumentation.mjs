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

assert.match(shell, /plugin-shell:run/, 'shell.run must log duration')
assert.match(docs, /document-target:provider-list/, 'document collect must time provider.list')
assert.match(docs, /document-target:collect-total/, 'document collect total required')
assert.match(bridge, /bridge-target:collect/, 'bridge collect timing required')
assert.match(session, /session:document-dynamic-partial-apply|session:host-dynamic-partial-apply/, 'session partial apply timing')
assert.match(session, /installLauncherPerfDebugApi/, 'session must install debug API')

assert.match(rust, /spawn_blocking/, 'native shell must use spawn_blocking')
assert.match(rust, /plugin_shell_run_blocking|native:plugin-shell-run/, 'native shell perf label')

console.log('launcher perf instrumentation checks passed')
