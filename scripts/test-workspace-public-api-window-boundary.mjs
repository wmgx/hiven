#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/pluginApi.ts', 'utf8')

assert.match(
  source,
  /getActiveEditorContextSnapshot/,
  'workspace public API must import synced editor context snapshots',
)

assert.match(
  source,
  /function readEditorContextSnapshot\(\)[\s\S]*if \(isEditorWindowRuntime\(\)\) return undefined[\s\S]*getActiveEditorContextSnapshot\(\)/,
  'workspace public API must only read synced editor context outside the editor runtime',
)

assert.match(
  source,
  /getActivePaneId\(\)[\s\S]*readEditorContextSnapshot\(\)\?\.activePaneId[\s\S]*useWorkspaceStore\.getState\(\)\.activePaneId/,
  'workspace public API getActivePaneId must prefer synced editor context outside editor windows',
)

assert.match(
  source,
  /getActivePaneText\(\)[\s\S]*readEditorContextSnapshot\(\)\?\.activeText[\s\S]*useWorkspaceStore\.getState\(\)\.getActivePaneText\(\)/,
  'workspace public API getActivePaneText must prefer synced editor context outside editor windows',
)

assert.match(
  source,
  /getPaneIds\(\)[\s\S]*readEditorContextSnapshot\(\)\?\.paneIds[\s\S]*useWorkspaceStore\.getState\(\)\.paneOrder/,
  'workspace public API getPaneIds must prefer synced editor context outside editor windows',
)

assert.match(
  source,
  /export function executeEffects\(effects: FluxEffect\[\]\)[\s\S]*if \(!isEditorWindowRuntime\(\)\)[\s\S]*Workspace effects can only be executed in the editor window[\s\S]*return applyEffects\(effects\)/,
  'workspace public API executeEffects must not mutate workspace state outside the editor window',
)

console.log('workspace public API window boundary checks passed')
