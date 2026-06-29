#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/pluginApi.ts', 'utf8')

assert.match(
  source,
  /getActiveEditorContextSnapshot[\s\S]*getActiveEditorPaneSnapshot/,
  'workspace public API must import synced editor context and pane snapshots',
)

assert.match(
  source,
  /function readEditorContextSnapshot\(\)[\s\S]*if \(isEditorWindowRuntime\(\)\) return undefined[\s\S]*getActiveEditorContextSnapshot\(\)[\s\S]*function readEditorPaneSnapshot\(\)[\s\S]*getActiveEditorPaneSnapshot\(\)/,
  'workspace public API must only read synced editor context outside the editor runtime',
)

assert.match(
  source,
  /getActivePaneId\(\)[\s\S]*if \(snapshot\) return snapshot\.activePaneId[\s\S]*isEditorWindowRuntime\(\) \? useWorkspaceStore\.getState\(\)\.activePaneId : ''/,
  'workspace public API getActivePaneId must not read launcher-local shadow workspace when no editor snapshot exists',
)

assert.match(
  source,
  /getActivePaneText\(\)[\s\S]*if \(snapshot\) return snapshot\.activeText[\s\S]*isEditorWindowRuntime\(\) \? useWorkspaceStore\.getState\(\)\.getActivePaneText\(\) : ''/,
  'workspace public API getActivePaneText must not read launcher-local shadow workspace when no editor snapshot exists',
)

assert.match(
  source,
  /getPaneText\(paneId\)[\s\S]*if \(snapshot\) return snapshot\.activePaneId === paneId \? snapshot\.activeText : undefined[\s\S]*isEditorWindowRuntime\(\) \? useWorkspaceStore\.getState\(\)\.panes\[paneId\]\?\.text : undefined/,
  'workspace public API getPaneText must not read pane text from launcher-local shadow workspace',
)

assert.match(
  source,
  /getPaneIds\(\)[\s\S]*readEditorPaneSnapshot\(\) \?\? readEditorContextSnapshot\(\)[\s\S]*if \(snapshot\) return snapshot\.paneIds[\s\S]*isEditorWindowRuntime\(\) \? useWorkspaceStore\.getState\(\)\.paneOrder : \[\]/,
  'workspace public API getPaneIds must not read launcher-local pane order when no editor snapshot exists',
)

assert.match(
  source,
  /getPaneTitle\(paneId\)[\s\S]*if \(snapshot\) return snapshot\.panes\[paneId\]\?\.title[\s\S]*isEditorWindowRuntime\(\) \? useWorkspaceStore\.getState\(\)\.panes\[paneId\]\?\.title : undefined/,
  'workspace public API getPaneTitle must not read launcher-local pane titles when no editor snapshot exists',
)

assert.match(
  source,
  /export function executeEffects\(effects: FluxEffect\[\]\)[\s\S]*if \(!isEditorWindowRuntime\(\)\)[\s\S]*Workspace effects can only be executed in the editor window[\s\S]*return applyEffects\(effects\)/,
  'workspace public API executeEffects must not mutate workspace state outside the editor window',
)

console.log('workspace public API window boundary checks passed')
