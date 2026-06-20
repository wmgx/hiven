#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function readOptional(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

const corePlugin = readOptional('src/workspace/corePlugin.ts')
const hostActions = read('src/workspace/launcher/hostActions.ts')
const builtinIndex = JSON.parse(read('src/builtin-plugins/index.json'))

assert.doesNotMatch(corePlugin, /core\.toggle-sticky-scroll/, 'sticky scroll command should not live in internal corePlugin')
assert.doesNotMatch(corePlugin, /core\.set-language/, 'set language command should not live in internal corePlugin')

assert.match(hostActions, /host:pane:toggle-sticky-scroll/, 'host launcher actions should own sticky scroll command')
assert.match(hostActions, /updatePaneStickyScroll\(state\.activePaneId,\s*next\)/, 'sticky scroll should update the active pane')
assert.match(hostActions, /host:pane:set-language/, 'host launcher actions should own set language command')
assert.match(hostActions, /updatePaneLanguageSource\(paneId,\s*['"]auto['"]\)|updatePaneLanguageSource\(paneId,\s*['"]manual['"]\)/, 'set language should preserve languageSource behavior')

assert.equal(builtinIndex.packages.some((entry) => entry.pluginId === 'core-pane'), false, 'core-pane should no longer ship as a builtin plugin')

// --- Regex Tester Plugin ---
const regexPlugin = read('src/plugins/regex-tester/index.tsx')
const regexManifest = JSON.parse(read('src/plugins/regex-tester/manifest.json'))
const regexEntry = builtinIndex.packages.find((entry) => entry.pluginId === 'regex-tester')

assert.doesNotMatch(corePlugin, /core\.regex-tester/, 'regex tester command should not live in internal corePlugin')
assert.doesNotMatch(corePlugin, /CoreRegexPanel/, 'regex tester panel should not be registered by internal corePlugin')
assert.match(regexPlugin, /id:\s*['"]regex-tester\.open['"]/, 'regex tester plugin should provide open command')
assert.match(regexPlugin, /id:\s*['"]regex-tester\.panel['"]/, 'regex tester plugin should provide panel contribution')
assert.equal(regexManifest.version, '1.0.1', 'regex tester plugin should be bumped after launcher migration')
assert.equal(regexEntry?.version, '1.0.1', 'builtin index should publish regex tester plugin')

// --- Final Guardrails ---
assert.doesNotMatch(corePlugin, /definePlugin\(\{\s*commands:/, 'internal corePlugin should not register user-facing commands')
assert.doesNotMatch(corePlugin, /registerProductionPlugin\(\s*['"]core['"]/, 'internal corePlugin should not register a production plugin')

console.log('core plugin externalization checks passed')
