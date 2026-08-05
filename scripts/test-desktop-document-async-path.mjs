#!/usr/bin/env node
/**
 * Desktop Target progressive document path must not block bridge/host dynamic collect.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const bridge = read('src/workspace/desktopTargets/collectBridgeLauncherItems.ts')
const documents = read('src/workspace/desktopTargets/collectDocumentLauncherItems.ts')
const host = read('src/workspace/launcher/hostProvider.ts')
const session = read('src/workspace/launcher/useLauncherSession.ts')

// Bridge path must only touch chromium, never fan-out collectDesktopTargets to all providers
assert.match(bridge, /browser\.chromium/, 'bridge collect must target browser.chromium')
// Ignore comments — only reject a real call expression.
assert.doesNotMatch(
  bridge.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
  /\bcollectDesktopTargets\s*\(/,
  'bridge must not call collectDesktopTargets over all providers (blocks on feishu 8s)',
)
assert.match(bridge, /find\(\s*\(p\)\s*=>\s*p\.id\s*===\s*CHROMIUM_SOURCE_ID|id === CHROMIUM_SOURCE_ID|browser\.chromium/, 'bridge should resolve only chromium provider')

// Document progressive collector exists
assert.match(documents, /getDesktopDocumentLauncherDynamicItems/, 'document collector export required')
assert.match(documents, /onPartial/, 'document collector must support progressive onPartial')
assert.match(documents, /listDocumentDesktopTargetProviders|EXCLUDED_SOURCE_IDS/, 'document path must exclude bridge/host window sources')
assert.match(documents, /signal/, 'document path must honor AbortSignal')

// Host provider must not await document CLI sources
assert.doesNotMatch(
  host,
  /getDesktopDocumentLauncherDynamicItems/,
  'host dynamic provider must not await document path (stays in progressive session path)',
)
assert.match(host, /Promise\.all/, 'host should parallelize app/window/bridge work')

// Session wires progressive document path with longer debounce
assert.match(session, /DOCUMENT_DYNAMIC_DEBOUNCE_MS|documentDynamicItems/, 'session must keep document dynamic items state')
assert.match(session, /getDesktopDocumentLauncherDynamicItems/, 'session must call document collector')
assert.match(session, /documentAbortRef|documentPartialsRef/, 'session must abort/merge document partials')
assert.match(
  session,
  /documentDynamicItems/,
  'ranked items must merge documentDynamicItems',
)
assert.ok(
  /DOCUMENT_DYNAMIC_DEBOUNCE_MS\s*=\s*(\d+)/.test(session) &&
    Number(session.match(/DOCUMENT_DYNAMIC_DEBOUNCE_MS\s*=\s*(\d+)/)[1]) >= 450,
  'document debounce should be >= 450ms to avoid CLI pile-up on partial queries',
)

console.log('desktop document async path checks passed')
