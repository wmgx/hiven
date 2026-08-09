#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/effectRunner.ts', 'utf8')

// Retired isEditorWindowRuntime: editor workspace effects are blocked for all hosts
// (launcher-only form factor). Only app.openExternal / status.message remain runnable.
assert.doesNotMatch(
  source,
  /isEditorWindowRuntime/,
  'effect runner must not reintroduce retired isEditorWindowRuntime',
)

assert.match(
  source,
  /const runnableEffects = effects\.filter\(\(effect\) => \{[\s\S]*isEditorWorkspaceEffect\(effect\)[\s\S]*Editor workspace effects can only run in the editor window[\s\S]*return false[\s\S]*return true/,
  'effect runner must filter editor workspace effects and report errors',
)

assert.match(
  source,
  /const surfaceEffects = runnableEffects\.filter/,
  'effect runner conflict detection must only inspect effects that are allowed to run',
)

assert.match(
  source,
  /for \(const effect of runnableEffects\)/,
  'effect runner must only apply effects that passed the filter',
)

assert.match(
  source,
  /function isEditorWorkspaceEffect\(effect: FluxEffect\): boolean[\s\S]*case ['"]app\.openExternal['"]:[\s\S]*case ['"]status\.message['"]:[\s\S]*return false[\s\S]*return true/,
  'effect runner must allow app/status effects while blocking workspace mutations',
)

assert.match(
  source,
  /export function applyEffectsAfterConfirmation\([\s\S]*if \(effects\.some\(isEditorWorkspaceEffect\)\)[\s\S]*Editor workspace effects can only run in the editor window/,
  'confirmed conflict replacement must refuse editor workspace effects',
)

assert.match(
  source,
  /export function applyEffectsAfterConfirmation\([\s\S]*if \(effects\.some\(isEditorWorkspaceEffect\)\)[\s\S]*return \{[\s\S]*applied: \[\][\s\S]*errors:[\s\S]*\}/,
  'confirmed conflict replacement must report boundary errors before mutating occupancy state',
)

console.log('effect runner window boundary checks passed')
