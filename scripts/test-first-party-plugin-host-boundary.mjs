#!/usr/bin/env node

/**
 * First-party plugins must consume host SDK boundaries, not workspace internals.
 * Updated for launcher-only form factor (PanelHostV2 / multi-pane hosts retired).
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const pluginHostSdk = readFileSync('src/pluginHostSdk.ts', 'utf8')
const editorBridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')
const pluginSdk = readFileSync('src/plugin-sdk.ts', 'utf8')
const jsFilter = readFileSync('src/plugins/jsFilter/index.tsx', 'utf8')
const regexTester =
  readFileSync('src/plugins/regex-tester/index.tsx', 'utf8') +
  '\n' +
  readFileSync('src/plugins/regex-tester/RegexTesterViews.tsx', 'utf8')
const architectureCheck = readFileSync('scripts/check-architecture.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:first-party-plugin-host-boundary'],
  'node scripts/test-first-party-plugin-host-boundary.mjs',
  'package.json must expose first-party plugin host boundary coverage',
)
assert.match(
  refactorSuite,
  /test:first-party-plugin-host-boundary/,
  'refactor suite must include first-party plugin host boundary coverage',
)

assert.match(
  pluginSdk,
  /MonacoDisposable/,
  '@hiven/plugin must re-export MonacoDisposable for first-party plugin type-only imports',
)

assert.match(
  pluginHostSdk,
  /monacoDisposables:[\s\S]*createBucket: typeof createMonacoDisposableBucket[\s\S]*disposeAll: typeof disposeAllMonacoDisposables/,
  'plugin host SDK must expose Monaco disposable helpers instead of requiring first-party plugins to deep-import utils',
)
assert.doesNotMatch(
  pluginHostSdk,
  /import\s*\{[^}]*\bDualEditorView\b|buildJsonDiffViewModel|useWorkspaceActions\s*:/,
  'public plugin host SDK must not expose Diff product kits or workspace write hooks',
)
assert.match(
  pluginHostSdk,
  /usePaneText: \(paneId\) => \{[\s\S]*React\.useSyncExternalStore\(\s*subscribeActiveEditorState,\s*\(\) => getMirroredEditorPaneText\(paneId\)/,
  'plugin host pane text hook must read mirrored editor context (not shadow workspace store)',
)
assert.doesNotMatch(
  pluginHostSdk,
  /usePaneText:[\s\S]{0,240}isEditorWindowRuntime/,
  'plugin host pane text hook must not reintroduce retired isEditorWindowRuntime',
)
assert.match(
  pluginHostSdk,
  /getMirroredEditorPaneText\(paneId: PaneId\)[\s\S]*snapshot\?\.activePaneId === paneId \? snapshot\.activeText : undefined/,
  'plugin host pane text hook must use mirrored editor context for non-editor windows',
)
assert.match(
  editorBridge,
  /export function subscribeActiveEditorState\(subscriber: \(\) => void\): \(\) => void[\s\S]*activeEditorStateSubscribers\.add\(subscriber\)/,
  'editor bridge must expose a subscription hook for mirrored editor state consumers',
)
assert.match(
  editorBridge,
  /function notifyActiveEditorStateSubscribers\(\): void[\s\S]*for \(const subscriber of activeEditorStateSubscribers\)/,
  'editor bridge must notify mirrored editor state subscribers when snapshots change',
)

assert.match(
  jsFilter,
  /kits\.monacoDisposables\.disposeAll\(editorDisposablesRef\.current\)[\s\S]*kits\.monacoDisposables\.createBucket\(\)/,
  'js-filter must use host SDK Monaco disposable helpers',
)
assert.doesNotMatch(
  jsFilter,
  /useWorkspaceStore|workspaceStore|runtimeRegistry|\.\.\/\.\.\//,
  'js-filter plugin must not import editor workspace internals directly',
)
assert.match(
  jsFilter,
  /function JsFilterPanel\(\{ host, paneId \}: PanelPropsV2\)[\s\S]*hooks\.usePaneText\(paneId \?\? ['"]['"]\) \?\? ['"]['"]/,
  'js-filter panel must read pane text through host SDK hooks and pane-scoped props',
)

// Retired multi-pane hosts must stay gone (do not resurrect as plugin deep imports).
assert.equal(existsSync('src/components/workspace/PanelHostV2.tsx'), false, 'PanelHostV2 must remain retired')
assert.equal(existsSync('src/components/workspace/PaneBottomPanels.tsx'), false, 'PaneBottomPanels must remain retired')

assert.match(
  architectureCheck,
  /checkPluginHostDeepImports|plugin must not deep-import host internals|checkPluginCrossImports/,
  'architecture check must keep plugin host boundary enforcement',
)

// Regex tester also uses host pane text hook
assert.match(
  regexTester,
  /hooks\.usePaneText/,
  'regex-tester must read pane text through host hooks',
)

console.log('first-party plugin host boundary checks passed')
