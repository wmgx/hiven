#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/effectRunner.ts', 'utf8')

assert.match(
  source,
  /function isEditorWindowRuntime\(\)[\s\S]*window\.location\.search[\s\S]*['"]editor['"]/,
  'effect runner must detect the editor window runtime before mutating workspace state',
)

assert.match(
  source,
  /const runnableEffects = effects\.filter\(\(effect\) => \{[\s\S]*isEditorWorkspaceEffect\(effect\)[\s\S]*Editor workspace effects can only run in the editor window[\s\S]*return false[\s\S]*return true/,
  'effect runner must filter editor workspace effects outside the editor window and report errors',
)

assert.match(
  source,
  /const surfaceEffects = runnableEffects\.filter/,
  'effect runner conflict detection must only inspect effects that are allowed to run in the current window',
)

assert.match(
  source,
  /for \(const effect of runnableEffects\)/,
  'effect runner must only apply effects that passed the window-boundary filter',
)

assert.match(
  source,
  /function isEditorWorkspaceEffect\(effect: FluxEffect\): boolean[\s\S]*case ['"]app\.openExternal['"]:[\s\S]*case ['"]status\.message['"]:[\s\S]*return false[\s\S]*return true/,
  'effect runner must allow app/status effects outside editor while blocking workspace mutations',
)


assert.match(
  source,
  /export function applyEffectsAfterConfirmation\([\s\S]*if \(!isEditorWindowRuntime\(\) && effects\.some\(isEditorWorkspaceEffect\)\)[\s\S]*Editor workspace effects can only run in the editor window[\s\S]*for \(const conflict of conflictsToReplace\)/,
  'confirmed conflict replacement must not release editor occupancies from non-editor windows',
)

assert.match(
  source,
  /export function applyEffectsAfterConfirmation\([\s\S]*if \(!isEditorWindowRuntime\(\) && effects\.some\(isEditorWorkspaceEffect\)\)[\s\S]*return \{[\s\S]*applied: \[\][\s\S]*errors:[\s\S]*\}[\s\S]*releaseOccupancy/,
  'confirmed conflict replacement must report boundary errors before mutating occupancy state',
)

console.log('effect runner window boundary checks passed')
