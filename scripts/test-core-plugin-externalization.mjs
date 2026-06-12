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

// --- Regex Tester Plugin ---
const regexPlugin = read('src/plugins/regex-tester/index.tsx')
const regexManifest = JSON.parse(read('src/plugins/regex-tester/manifest.json'))
const regexEntry = builtinIndex.packages.find((entry) => entry.pluginId === 'regex-tester')

assert.doesNotMatch(corePlugin, /core\.regex-tester/, 'regex tester command should not live in internal corePlugin')
assert.doesNotMatch(corePlugin, /CoreRegexPanel/, 'regex tester panel should not be registered by internal corePlugin')
assert.match(regexPlugin, /id:\s*['"]regex-tester\.open['"]/, 'regex tester plugin should provide open command')
assert.match(regexPlugin, /id:\s*['"]regex-tester\.panel['"]/, 'regex tester plugin should provide panel contribution')
assert.equal(regexManifest.version, '1.0.0', 'regex tester plugin starts at version 1.0.0')
assert.equal(regexEntry?.version, '1.0.0', 'builtin index should publish regex tester plugin')

// --- Final Guardrails ---
assert.doesNotMatch(corePlugin, /definePlugin\(\{\s*commands:/, 'internal corePlugin should not register user-facing commands')
assert.doesNotMatch(corePlugin, /registerProductionPlugin\(\s*['"]core['"]/, 'internal corePlugin should not register a production plugin')

console.log('core plugin externalization checks passed')
