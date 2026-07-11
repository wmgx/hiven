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
 *   - host app search is isolated from plugin compute dynamics
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pluginTypes = readFileSync('src/workspace/pluginTypes.ts', 'utf8')
const registry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
const types = readFileSync('src/workspace/launcher/types.ts', 'utf8')
const globalLauncher = readFileSync('src/components/GlobalLauncher.tsx', 'utf8')
const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const quickEditorCommandOverlay = readFileSync('src/components/quickEditor/QuickEditorCommandOverlay.tsx', 'utf8')
const launcherSession = readFileSync('src/workspace/launcher/useLauncherSession.ts', 'utf8')
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
assert.match(registry, /onPartial/, 'registry collectDynamicItems should support progressive onPartial')
assert.match(registry, /includeHost/, 'registry should support isolating host dynamic collection')
assert.match(registry, /includePlugins/, 'registry should support isolating plugin dynamic collection')

// Surfaces consume dynamic items through the shared session.
assert.match(globalLauncher, /GlobalLauncherHost/, 'GlobalLauncher should delegate to GlobalLauncherHost')
assert.match(globalLauncherHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]global-launcher['"]/, 'GlobalLauncherHost should use the shared launcher session')
assert.match(quickEditorCommandOverlay, /useLauncherSession/, 'Quick editor command overlay should use the shared launcher session')
assert.match(launcherSession, /collectDynamicItems\(q,\s*normalizedHostId/, 'shared launcher session should consume dynamic items from the registry')
assert.match(launcherSession, /includeHost:\s*false/, 'plugin dynamic path should isolate from host app search')
assert.match(launcherSession, /includePlugins:\s*false/, 'host dynamic path should isolate from plugin providers')
assert.match(launcherSession, /onPartial/, 'launcher session should consume progressive dynamic partials')
assert.match(launcherSession, /PLUGIN_DYNAMIC_DEBOUNCE_MS/, 'plugin compute path should use a short debounce')
assert.match(launcherSession, /HOST_DYNAMIC_DEBOUNCE_MS/, 'host app path should use a longer debounce')

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
