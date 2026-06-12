#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const corePlugin = read('src/workspace/corePlugin.ts')
const corePanePlugin = read('src/plugins/core-pane/index.ts')
const corePaneManifest = JSON.parse(read('src/plugins/core-pane/manifest.json'))
const builtinIndex = JSON.parse(read('src/builtin-plugins/index.json'))
const corePaneEntry = builtinIndex.packages.find((entry) => entry.pluginId === 'core-pane')

assert.doesNotMatch(corePlugin, /core\.toggle-sticky-scroll/, 'sticky scroll command should not live in internal corePlugin')
assert.doesNotMatch(corePlugin, /core\.set-language/, 'set language command should not live in internal corePlugin')

assert.match(corePanePlugin, /id:\s*['"]core-pane\.toggle-sticky-scroll['"]/, 'core-pane should own sticky scroll command')
assert.match(corePanePlugin, /type:\s*['"]pane\.update['"][\s\S]*stickyScroll/, 'sticky scroll should remain a pane update effect')
assert.match(corePanePlugin, /id:\s*['"]core-pane\.set-language['"]/, 'core-pane should own set language command')
assert.match(corePanePlugin, /languageSource:\s*['"]manual['"]|languageSource:\s*['"]auto['"]/, 'set language should preserve languageSource behavior')

assert.equal(corePaneManifest.version, '1.2.0', 'core-pane manifest version should be bumped')
assert.equal(corePaneEntry?.version, '1.2.0', 'builtin index should publish bumped core-pane version')

console.log('core plugin externalization checks passed')
