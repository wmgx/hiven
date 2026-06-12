#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const quickTextCommand = read('src/workspace/quickTextCommand.ts')
const globalLauncher = read('src/components/GlobalLauncher.tsx')
const packageJson = read('package.json')

assert.match(packageJson, /test:global-launcher-quick-text/, 'package.json should expose the quick text verifier')
assert.match(quickTextCommand, /isQuickTextCommand/, 'quickTextCommand should expose an eligibility predicate')
assert.match(quickTextCommand, /runQuickTextCommand/, 'quickTextCommand should expose a runner')
assert.match(quickTextCommand, /slot\.kind\s*!==\s*['"]text['"]/, 'eligibility should reject non-text input slots')
assert.match(quickTextCommand, /command\.surfaces\?\.quickText\s*===\s*false/, 'eligibility should honor explicit quickText opt-out')
assert.match(quickTextCommand, /effectiveQuickTextParams/, 'eligibility should be based on merged command defaults and quick defaults')
assert.match(quickTextCommand, /param\.default\s*===\s*undefined[\s\S]{0,220}quickTextDefaults/, 'eligibility should reject params without effective quick defaults')
assert.match(quickTextCommand, /runTextPluginCommand/, 'quick runner should reuse runTextPluginCommand')
assert.match(globalLauncher, /quickTextSession/, 'GlobalLauncher should model a quick text session')
assert.match(globalLauncher, /copyQuickTextOutput/, 'GlobalLauncher should centralize quick output clipboard writes')
assert.match(globalLauncher, /writeText\(session\.outputText/, 'quick output copy helper should write preview text to clipboard')
assert.match(globalLauncher, /setQuickTextSession\(null\)/, 'Escape should leave quick text mode before closing the launcher')
assert.match(globalLauncher, /quickTextSession\?\.outputText\.length|quickTextSession\?\.running|quickTextSession\?\.inputText\.length/, 'standalone launcher resize should react to quick session content')
assert.match(globalLauncher, /global-launcher-quick-preview[\s\S]{0,500}max-h|global-launcher-quick-preview[\s\S]{0,500}overflow-auto/, 'quick preview should have bounded height and scroll')
assert.match(globalLauncher, /shouldIgnoreImeKeyDown/, 'quick input should reuse the IME Enter guard')
assert.doesNotMatch(globalLauncher, /quickTextSession[\s\S]{0,800}applyEffects\(\[\{[\s\S]{0,120}text\.replace/, 'quick text mode must not apply output to the editor')

console.log('global launcher quick text checks passed')
