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

assert.match(
  source,
  /function isEditorWindowRuntime\(\)[\s\S]*window\.location\.search[\s\S]*['"]editor['"]/,
  'surface coordinator must detect the editor window runtime explicitly',
)
assert.match(
  source,
  /function readEditorOccupancies\(\)[\s\S]*isEditorWindowRuntime\(\) \? useWorkspaceStore\.getState\(\)\.occupancies : \{\}/,
  'surface coordinator must not read shadow occupancies outside the editor window',
)
assert.match(
  source,
  /export function registerOccupancy[\s\S]*if \(!isEditorWindowRuntime\(\)\) return[\s\S]*useWorkspaceStore\.setState/,
  'registerOccupancy must no-op outside the editor runtime',
)
assert.match(
  source,
  /export function releaseOccupancy[\s\S]*if \(!isEditorWindowRuntime\(\)\) return[\s\S]*runtimeRegistry\.disposeOwner/,
  'releaseOccupancy must not dispose local runtime resources outside the editor runtime',
)
assert.match(
  source,
  /export function executeExitPolicy[\s\S]*if \(!isEditorWindowRuntime\(\)\) return true/,
  'executeExitPolicy must not mutate shadow occupancy state outside the editor runtime',
)
for (const fn of ['detectConflicts', 'getOccupanciesForSurface', 'getOccupanciesByOwner', 'isSurfaceExclusivelyOccupied']) {
  assert.match(
    source,
    new RegExp(`${fn}[\\s\\S]*readEditorOccupancies\\(\\)`),
    `${fn} must read occupancies through the editor-window guard`,
  )
}

console.log('surface coordinator window boundary checks passed')
