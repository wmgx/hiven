#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const source = readFileSync('src/workspace/surfaceCoordinator.ts', 'utf8')

assert.equal(
  packageJson.scripts?.['test:surface-coordinator-window-boundary'],
  'node scripts/test-surface-coordinator-window-boundary.mjs',
  'package.json must expose surface coordinator window boundary coverage',
)
assert.match(
  refactorSuite,
  /test:surface-coordinator-window-boundary/,
  'refactor suite must include surface coordinator window boundary coverage',
)

// Retired isEditorWindowRuntime: occupancy mutations are hard no-ops.
assert.doesNotMatch(
  source,
  /isEditorWindowRuntime/,
  'surface coordinator must not reintroduce retired isEditorWindowRuntime',
)
assert.match(
  source,
  /function readEditorOccupancies\(\): Record<string, SurfaceOccupancy> \{\s*return \{\}\s*\}/,
  'readEditorOccupancies must return empty (no shadow workspace occupancies)',
)
assert.match(
  source,
  /export function registerOccupancy\(_?occupancy: SurfaceOccupancy\) \{\s*return\s*\}/,
  'registerOccupancy must no-op',
)
assert.match(
  source,
  /export function releaseOccupancy\(_?occupancyId: string\) \{\s*return\s*\}/,
  'releaseOccupancy must no-op',
)
assert.match(
  source,
  /export function executeExitPolicy\(_?occupancyId: string\): boolean \{\s*return true\s*\}/,
  'executeExitPolicy must no-op with success',
)
assert.match(
  source,
  /detectConflicts[\s\S]*readEditorOccupancies\(\)/,
  'detectConflicts must read occupancies through the empty guard',
)

console.log('surface coordinator window boundary checks passed')
