#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  scriptsView: read('src/views/ScriptsView.tsx'),
  pluginEditorView: read('src/views/PluginEditorView.tsx'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  pinnedRunner: read('src/views/PinnedRunnerView.tsx'),
  pluginScaffold: read('src/workspace/pluginScaffold.ts'),
}

const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

check('package exposes the plugin authoring UI contract verifier', () => {
  assertHas(files.packageJson, /test:plugin-authoring-ui-contract/, 'package.json should expose this verifier')
})

check('New Plugin creates a dev package, side-loads it, and opens the editor', () => {
  assertHas(files.scriptsView, /data-testid=['"]plugin-new-button['"]/, 'New Plugin button should have a stable test id')
  assertHas(files.scriptsView, /createDevPluginScaffold\(\)/, 'New Plugin should use createDevPluginScaffold')
  assertHas(files.scriptsView, /setActiveTab\(['"]dev['"]\)/, 'New Plugin should switch to dev tab')
  assertHas(files.scriptsView, /openPluginEditor\(\{\s*pluginId:\s*plugin\.pluginId[\s\S]*source:\s*['"]dev['"]/, 'New Plugin should open the created dev package editor')
})

check('Plugin editor exposes stable runnable debug controls', () => {
  assertHas(files.pluginEditorView, /data-testid=['"]plugin-editor-run-button['"]/, 'debug Run button should be targetable')
  assertHas(files.pluginEditorView, /data-testid=['"]plugin-editor-debug-input['"]/, 'debug input should be targetable')
  assertHas(files.pluginEditorView, /data-testid=['"]plugin-editor-debug-output['"]/, 'debug output should be targetable')
  assertHas(files.pluginEditorView, /runPluginDebugSource\(content/, 'debug run should execute current plugin source')
})

check('Command palette exposes a stable pin control for plugin commands', () => {
  assertHas(files.commandPalette, /data-testid=['"]command-palette-pin-action['"]/, 'Pin action button should be targetable')
  assertHas(files.commandPalette, /pinPluginCommand\(\{[\s\S]*kind:\s*['"]plugin-command['"]/, 'plugin command pin path should call pinPluginCommand')
})

check('Pinned runner exposes stable live-runner controls and buffers', () => {
  for (const [testId, label] of [
    ['pinned-runner-run-button', 'Run Now'],
    ['pinned-runner-copy-output', 'Copy Output'],
    ['pinned-runner-clear-input', 'Clear Input'],
    ['pinned-runner-clear-output', 'Clear Output'],
  ]) {
    assertHas(files.pinnedRunner, new RegExp(`data-testid=['"]${testId}['"]`), `${label} should be targetable`)
  }
  for (const [testId, label] of [
    ['pinned-runner-input-buffer', 'input buffer'],
    ['pinned-runner-output-buffer', 'output buffer'],
  ]) {
    assertHas(files.pinnedRunner, new RegExp(`testId=['"]${testId}['"]`), `${label} should pass a stable test id to the Monaco wrapper`)
  }
  assertHas(files.pinnedRunner, /data-testid=\{testId\}/, 'PinnedMonacoBuffer should render its testId as a DOM data-testid')
})

check('Scaffolded plugins stay on the injected SDK contract', () => {
  assertHas(files.pluginScaffold, /globalThis\.FluxTextPlugin/, 'scaffold should use injected SDK')
  assertHas(files.pluginScaffold, /\{\s*definePlugin,\s*effects,\s*ui\s*\}\s*=\s*globalThis\.FluxTextPlugin/, 'scaffold should expose ui helpers')
  assert.doesNotMatch(files.pluginScaffold, /\.\.\/workspace|@\/workspace/, 'scaffold should not import framework internals')
})

if (failures.length > 0) {
  console.error(`plugin authoring UI contract checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('plugin authoring UI contract checks passed')
