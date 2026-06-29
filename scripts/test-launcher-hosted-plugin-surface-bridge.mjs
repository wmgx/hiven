#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const openRequest = readFileSync('src/workspace/pluginSurfaceOpenRequest.ts', 'utf8')

assert.equal(
  packageJson.scripts?.['test:launcher-hosted-plugin-surface-bridge'],
  'node scripts/test-launcher-hosted-plugin-surface-bridge.mjs',
  'package.json must expose launcher-hosted plugin surface bridge coverage',
)
assert.match(
  refactorSuite,
  /test:launcher-hosted-plugin-surface-bridge/,
  'refactor suite must include launcher-hosted plugin surface bridge coverage',
)

assert.match(
  openRequest,
  /export function openLauncherHostedPluginSurface\(target: PluginSurfaceOpenTarget\): void \{[\s\S]*openPluginSurfaceTool\(target\)[\s\S]*openGlobalLauncherOverlay\('pinned-only'\)/,
  'launcher-hosted plugin surfaces must have one explicit bridge that owns AppStore writes',
)
assert.match(
  app,
  /openLauncherHostedPluginSurface/,
  'App must route plugin surface open events through the launcher-hosted surface bridge',
)
assert.doesNotMatch(
  app,
  /openPluginSurfaceTool\(/,
  'App must not directly write pluginSurfaceToolTarget; use openLauncherHostedPluginSurface instead',
)
assert.match(
  app,
  /consumePendingPluginSurfaceOpenTarget\(\)[\s\S]*openLauncherHostedPluginSurface\(pendingSurfaceTarget\)/,
  'launcher startup must drain pending plugin surface requests through the bridge',
)
assert.match(
  app,
  /listen\('hiven:\/\/open-plugin-surface'[\s\S]*openLauncherHostedPluginSurface\(event\.payload\)/,
  'launcher event handling must dispatch plugin surface requests through the bridge',
)

console.log('launcher-hosted plugin surface bridge checks passed')
