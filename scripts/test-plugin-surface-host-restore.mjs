#!/usr/bin/env node
/**
 * ESC is system-owned global back:
 * - tool surface (Diff) → pop to list or restored host
 * - never jump straight to closeLauncher from leaveSurface
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = readFileSync('src/store.ts', 'utf8')
const surfaceFrame = readFileSync('src/components/launcher/GlobalLauncherSurfaceFrame.ts', 'utf8')
const hostEscape = readFileSync('src/components/launcher/GlobalLauncherHostLifecycle.ts', 'utf8')

assert.match(
  store,
  /previousLauncherHostSurfaceTarget/,
  'store must remember the host surface suspended by a plugin tool shell',
)
assert.match(
  store,
  /openPluginSurfaceTool:[\s\S]*previousLauncherHostSurfaceTarget[\s\S]*launcherHostSurfaceTarget:\s*null/,
  'openPluginSurfaceTool must suspend the current host surface',
)
assert.match(
  store,
  /restorePreviousLauncherHostSurface/,
  'store must expose restorePreviousLauncherHostSurface for ESC/back',
)
assert.match(
  surfaceFrame,
  /restorePreviousLauncherHostSurface\(\)/,
  'leaveSurface (ESC/back) must try restoring the suspended host surface first',
)
assert.match(
  surfaceFrame,
  /clearPluginSurfaceTool\(\)/,
  'leaveSurface must clear the tool surface target so it does not re-open',
)
assert.match(
  surfaceFrame,
  /onReturnedToList/,
  'leaveSurface must return to the launcher list when no host is suspended',
)
const leaveSurfaceBody = surfaceFrame.match(
  /const leaveSurface = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/,
)?.[1] ?? ''
assert.ok(leaveSurfaceBody, 'leaveSurface callback body must be present')
assert.doesNotMatch(
  leaveSurfaceBody,
  /closeLauncher\s*\(/,
  'leaveSurface must never call closeLauncher — only explicit close (×) may',
)
assert.match(
  surfaceFrame,
  /const closeSurface = useCallback\(\(\) => \{[\s\S]*?closeLauncher\(\)/,
  'explicit closeSurface (×) may still close the launcher',
)
assert.match(
  hostEscape,
  /System-owned Escape|global back/,
  'host Escape handler must document system-owned global back semantics',
)
assert.match(
  hostEscape,
  /controllerRef\.current\?\.back[\s\S]*closeLauncher\(\)/,
  'root Escape closes launcher only after controller frames are exhausted',
)

console.log('plugin surface host restore checks passed')
