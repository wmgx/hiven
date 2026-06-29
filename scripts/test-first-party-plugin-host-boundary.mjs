#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const pluginTypes = readFileSync('src/workspace/pluginTypes.ts', 'utf8')
const panelHost = readFileSync('src/components/workspace/PanelHostV2.tsx', 'utf8')
const paneBottomPanels = readFileSync('src/components/workspace/PaneBottomPanels.tsx', 'utf8')
const jsFilter = readFileSync('src/plugins/jsFilter/index.tsx', 'utf8')

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
assert.doesNotMatch(
  jsFilter,
  /useWorkspaceStore|workspaceStore|runtimeRegistry/,
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

console.log('first-party plugin host boundary checks passed')
