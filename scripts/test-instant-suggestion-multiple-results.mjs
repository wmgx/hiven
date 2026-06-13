#!/usr/bin/env node
/**
 * test-instant-suggestion-multiple-results.mjs
 *
 * Verifies that dynamic launcher items support multiple results per provider
 * (replaces the old InstantSuggestionProvider multi-result test).
 *
 * The new contract:
 *   - PluginDefinition.launcher.dynamicItems returns LauncherItemContribution[]
 *   - Providers returning multiple items are supported (arrays of any length)
 *   - Both launcher surfaces consume dynamic items via collectDynamicItems()
 *   - date-time-assistant produces multiple items for "now" queries
 *   - calculator produces a single item per calculation
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pluginTypes = readFileSync('src/workspace/pluginTypes.ts', 'utf8')
const registry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
const types = readFileSync('src/workspace/launcher/types.ts', 'utf8')
const commandPalette = readFileSync('src/components/CommandPalette.tsx', 'utf8')
const globalLauncher = readFileSync('src/components/GlobalLauncher.tsx', 'utf8')
const calculator = readFileSync('src/plugins/calculator/index.ts', 'utf8')
const dateTime = readFileSync('src/plugins/date-time-assistant/index.ts', 'utf8')

// Dynamic items provider signature returns an array (supports 0, 1, or N items)
assert.match(
  types,
  /LauncherDynamicItemProvider\s*=\s*\(/,
  'LauncherDynamicItemProvider type should be defined in launcher types',
)
assert.match(
  types,
  /LauncherItemContribution\[\]/,
  'LauncherDynamicItemProvider should return an array (supporting multiple results)',
)

// PluginDefinition has launcher.dynamicItems field
assert.match(
  pluginTypes,
  /dynamicItems\?\s*:\s*LauncherDynamicItemProvider/,
  'PluginDefinition.launcher should include dynamicItems field',
)

// Registry collects dynamic items and handles per-provider error isolation
assert.match(
  registry,
  /collectDynamicItems/,
  'Registry should export collectDynamicItems',
)
assert.match(
  registry,
  /catch[\s\S]*?console\.warn/,
  'Dynamic provider errors should be caught and isolated',
)

// CommandPalette consumes dynamic items from registry
assert.match(
  commandPalette,
  /collectDynamicItems|dynamicItems/,
  'CommandPalette should use dynamic items from the registry',
)

// GlobalLauncher consumes dynamic items from registry
assert.match(
  globalLauncher,
  /collectDynamicItems|dynamicItems/,
  'GlobalLauncher should use dynamic items from the registry',
)

// date-time-assistant returns multiple items for "now" queries
assert.match(
  dateTime,
  /dt-now-timestamp[\s\S]*dt-now-datetime/,
  'date-time-assistant dynamicItems should produce multiple items for "now" queries',
)

// calculator returns a single item per calculation
assert.match(
  calculator,
  /dynamicItems[\s\S]*return\s*\[\{/,
  'calculator dynamicItems should return an array with one item per calculation',
)

console.log('instant suggestion multiple result checks passed')
