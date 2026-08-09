#!/usr/bin/env node
/**
 * B2 retirement: pluginActionManifest is deleted.
 * Transform plugins use accepts/textMatch ranking; host pins only remain
 * in actionRecommendation.ts.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(
  existsSync('src/launcher/clipboard/pluginActionManifest.ts'),
  false,
  'pluginActionManifest.ts must be deleted (B2 single-track ranking)',
)

const index = readFileSync('src/launcher/clipboard/index.ts', 'utf8')
assert.doesNotMatch(
  index,
  /registerPluginActionManifest|discoverActionsForBlock/,
  'clipboard barrel must not re-export retired pluginActionManifest',
)

const actions = readFileSync('src/launcher/clipboard/actionRecommendation.ts', 'utf8')
assert.doesNotMatch(actions, /discoverActionsForBlock/, 'recommend path must not merge manifest registry')
assert.match(actions, /Host-owned Object Block pin actions/, 'actionRecommendation is host-pins only')

console.log('test-plugin-action-manifest: retired (ok)')
