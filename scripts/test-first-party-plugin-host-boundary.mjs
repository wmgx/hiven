#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const pluginTypes = readFileSync('src/workspace/pluginTypes.ts', 'utf8')
const pluginHostSdk = readFileSync('src/pluginHostSdk.ts', 'utf8')
const pluginSdk = readFileSync('src/plugin-sdk.ts', 'utf8')
const panelHost = readFileSync('src/components/workspace/PanelHostV2.tsx', 'utf8')
const paneBottomPanels = readFileSync('src/components/workspace/PaneBottomPanels.tsx', 'utf8')
const jsFilter = readFileSync('src/plugins/jsFilter/index.tsx', 'utf8')
const regexTester = readFileSync('src/plugins/regex-tester/index.tsx', 'utf8')
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
  pluginTypes,
  /export type PanelPropsV2[\s\S]*paneId\?: PaneId[\s\S]*host: PanelHostApi/,
  'panel props must expose pane scope through the host boundary instead of requiring plugins to import workspace state',
)
assert.match(
  panelHost,
  /paneId=\{instance\.scope\?\.type === ['"]pane['"] \? instance\.scope\.paneId : undefined\}/,
  'shared panel host must pass pane-scoped panel ids through PanelPropsV2',
)
assert.match(
  paneBottomPanels,
  /paneId=\{instance\.scope\?\.type === ['"]pane['"] \? instance\.scope\.paneId : undefined\}/,
  'pane-bottom panel host must pass pane-scoped panel ids through PanelPropsV2',
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
assert.match(
  jsFilter,
  /execute\(ctx\)[\s\S]*ctx\.api\.isPanePanelOpen\(PANEL_ID\)[\s\S]*ctx\.api\.dispatchEffects/,
  'js-filter launcher item toggle must use the launcher plugin API instead of workspace internals',
)
assert.match(
  jsFilter,
  /run\(ctx\)[\s\S]*const paneId = \(ctx\.inputs\.input as PaneInput\)\.paneId[\s\S]*type: ['"]panel\.openV2['"]/,
  'js-filter command fallback must open its pane-scoped panel from resolved plugin inputs without reading workspace state',
)


assert.doesNotMatch(
  regexTester,
  /useWorkspaceStore|workspaceStore/,
  'regex-tester plugin wrapper must not import editor workspace internals directly',
)
assert.match(
  regexTester,
  /function RegexTesterPluginPanel\(\{ panelId, host, paneId \}: PanelPropsV2<unknown>\)[\s\S]*activePaneId=\{paneId \?\? ['"]['"]\}/,
  'regex-tester plugin wrapper must receive pane scope through PanelPropsV2',
)
assert.match(
  regexTester,
  /execute\(ctx\)[\s\S]*ctx\.api\.getPaneSnapshot\(\)\.activePaneId[\s\S]*placement: ['"]pane-bottom['"][\s\S]*scope: \{ type: ['"]pane['"] as const, paneId:/,
  'regex-tester launcher item must open a pane-scoped panel through launcher API context',
)


assert.match(
  regexTester,
  /inputs: \[\{ key: ['"]input['"], label: ['"]Input['"], kind: ['"]pane['"] as const, required: true \}\][\s\S]*run\(ctx\)[\s\S]*const paneId = \(ctx\.inputs\.input as PaneInput\)\.paneId[\s\S]*scope: \{ type: ['"]pane['"] as const, paneId \}/,
  'regex-tester command fallback must resolve pane scope from plugin inputs instead of launcher-only APIs',
)



assert.match(
  architectureCheck,
  /checkPluginCrossImports[\s\S]*only block plugin→plugin escapes here[\s\S]*isWithin\(resolved, pluginsDir\)/,
  'plugin cross-import architecture check must not confuse host helper imports with plugin-to-plugin imports',
)

assert.doesNotMatch(
  architectureCheck,
  /legacyAllowList = new Set\(\[[^\]]*['"]jsFilter['"]|legacyAllowList = new Set\(\[[^\]]*['"]regex-tester['"]/,
  'js-filter and regex-tester must not remain in plugin host deep-import architecture allowlists',
)

console.log('first-party plugin host boundary checks passed')
