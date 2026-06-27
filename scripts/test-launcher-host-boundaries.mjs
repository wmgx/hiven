#!/usr/bin/env node
/**
 * Phase 0 launcher host boundary contract.
 *
 * Covers Task 2:
 * - legacy command-palette ids normalize to editor-command-bar
 * - Editor Command Bar excludes app launch, system power, settings/plugin manager
 * - Editor Command Bar exposes a Search all Hiven handoff entry
 * - legacy usage bucket migrates into the editor-command-bar bucket
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

function read(path) {
  return readFileSync(path, 'utf8')
}

function loadTsModule(path, rewrite = (source) => source) {
  const source = rewrite(read(path))
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
  }
  vm.runInNewContext(transpiled, sandbox, { filename: path })
  return sandbox.module.exports
}

function blockAround(source, marker, nextMarker = /\n\s*\},\n\s*\{/g) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  nextMarker.lastIndex = start + marker.length
  const next = nextMarker.exec(source)
  return source.slice(start, next ? next.index : source.length)
}

function hasSurface(block, surfaceId) {
  return new RegExp(`['"]${surfaceId.replaceAll('-', '\\-')}['"]`).test(block)
}

function assertGlobalOnly(block, label) {
  check(block.length > 0, `${label} item must exist`)
  check(hasSurface(block, 'global-launcher'), `${label} must remain available in GlobalLauncher`)
  check(!hasSurface(block, 'editor-command-bar'), `${label} must not be exposed in Editor Command Bar`)
  check(!hasSurface(block, 'command-palette'), `${label} must not keep the legacy command-palette surface`)
}

const typesSource = read('src/workspace/launcher/types.ts')
const usageSource = read('src/workspace/launcher/usage.ts')
const hostActionsSource = read('src/workspace/launcher/hostActions.ts')
const appLauncherSource = read('src/workspace/appLauncher/hostAppLauncher.ts')
const commandPaletteSource = read('src/components/CommandPalette.tsx')
const globalLauncherSource = read('src/components/GlobalLauncher.tsx')
const registrySource = read('src/workspace/launcher/registry.ts')

// 1. Launcher host/surface identity and legacy normalization.
check(/export\s+type\s+LauncherHostId/.test(typesSource), 'LauncherHostId must be exported')
check(/editor-command-bar/.test(typesSource), 'editor-command-bar must be a first-class launcher host/surface id')
check(/global-launcher/.test(typesSource), 'global-launcher must remain a first-class launcher host/surface id')
check(/normalizeLauncherSurfaceId/.test(typesSource), 'normalizeLauncherSurfaceId must be exported for legacy compatibility')

try {
  const types = loadTsModule('src/workspace/launcher/types.ts')
  check(
    Array.isArray(types.LAUNCHER_SURFACE_IDS) && types.LAUNCHER_SURFACE_IDS.includes('editor-command-bar'),
    'LAUNCHER_SURFACE_IDS must include editor-command-bar',
  )
  check(
    Array.isArray(types.LAUNCHER_SURFACE_IDS) && !types.LAUNCHER_SURFACE_IDS.includes('command-palette'),
    'LAUNCHER_SURFACE_IDS must not keep command-palette as a primary bucket',
  )
  check(typeof types.normalizeLauncherSurfaceId === 'function', 'normalizeLauncherSurfaceId must be callable at runtime')
  if (typeof types.normalizeLauncherSurfaceId === 'function') {
    check(
      types.normalizeLauncherSurfaceId('command-palette') === 'editor-command-bar',
      'legacy command-palette must normalize to editor-command-bar',
    )
    check(
      types.normalizeLauncherSurfaceId('editor-command-bar') === 'editor-command-bar',
      'editor-command-bar must normalize to itself',
    )
  }
} catch (error) {
  failures.push(`types.ts runtime contract failed: ${error instanceof Error ? error.message : String(error)}`)
}

check(
  /surfaceId:\s*['"]editor-command-bar['"]/.test(commandPaletteSource)
    || /EditorCommandBarHost/.test(commandPaletteSource),
  'CommandPalette must be a compatibility wrapper around EditorCommandBarHost/editor-command-bar',
)
check(
  !/surfaceId:\s*['"]command-palette['"]/.test(commandPaletteSource),
  'CommandPalette must not instantiate LauncherController with command-palette',
)

// 2. Editor Command Bar default scope excludes global app/system/settings capabilities.
assertGlobalOnly(blockAround(hostActionsSource, "systemKey: 'host:view:settings'"), 'Settings')
assertGlobalOnly(blockAround(hostActionsSource, "systemKey: 'host:view:plugins'"), 'Plugin manager')

for (const key of ['host:system:restart', 'host:system:shutdown', 'host:system:lock-screen']) {
  assertGlobalOnly(blockAround(hostActionsSource, `systemKey: '${key}'`), key)
}

assertGlobalOnly(blockAround(appLauncherSource, "systemKey: 'host:app-launcher:refresh'"), 'Refresh Applications Index')
check(
  /surfaceId\s*!==\s*['"]global-launcher['"][\s\S]{0,80}return\s+\[\]/.test(appLauncherSource),
  'dynamic app launcher results must be guarded to GlobalLauncher only',
)
check(
  !/collectStaticCandidates\(\s*['"]command-palette['"]\s*\)/.test(commandPaletteSource),
  'Editor command bar must not collect static candidates through command-palette',
)
check(
  !/collectDynamicItems\([^)]*['"]command-palette['"]/.test(commandPaletteSource),
  'Editor command bar must not collect dynamic candidates through command-palette',
)

// 3. Editor Command Bar handoff to global search.
const launcherSources = [
  typesSource,
  usageSource,
  hostActionsSource,
  appLauncherSource,
  commandPaletteSource,
  globalLauncherSource,
  registrySource,
].join('\n')

check(
  /Search all Hiven(?:\.\.\.|…)?/.test(launcherSources),
  'Editor Command Bar must expose a "Search all Hiven..." entry',
)

const searchAllBlock = blockAround(launcherSources, 'Search all Hiven')
check(
  searchAllBlock.length > 0 && hasSurface(searchAllBlock, 'editor-command-bar'),
  'Search all Hiven entry must be visible from editor-command-bar',
)
check(
  searchAllBlock.length > 0 && !hasSurface(searchAllBlock, 'global-launcher'),
  'Search all Hiven entry itself must not appear inside GlobalLauncher',
)
check(
  /showGlobalLauncher|show_launcher_window|setGlobalLauncherOpen|globalLauncherOpen|GlobalLauncher/.test(searchAllBlock),
  'Search all Hiven entry must hand off to the GlobalLauncher',
)

// 4. Legacy usage migration into the new editor-command-bar bucket.
try {
  const usage = loadTsModule('src/workspace/launcher/usage.ts', (source) => source
    .replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'\.\/types'\s*;?\s*\n?/g, '')
    .replace(
      /import\s*\{\s*LAUNCHER_SURFACE_IDS\s*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
      "const LAUNCHER_SURFACE_IDS = ['editor-command-bar', 'global-launcher'];\n",
    ))

  const empty = usage.emptyUsageBySurface()
  check(Object.hasOwn(empty, 'editor-command-bar'), 'empty usage must allocate editor-command-bar bucket')
  check(!Object.hasOwn(empty, 'command-palette'), 'empty usage must not allocate command-palette bucket')

  const migrated = usage.migrateLegacyUsage(
    {
      'command-palette': {
        recentActionNames: ['legacy.reverse'],
        actionUsageCounts: { 'legacy.reverse': 7 },
      },
      'global-launcher': {
        recentActionNames: ['global.open'],
        actionUsageCounts: { 'global.open': 3 },
      },
    },
    (legacyKey) => `host:legacy:${legacyKey}`,
    1000,
  )

  check(
    migrated['editor-command-bar']?.['host:legacy:legacy.reverse']?.count === 7,
    'legacy command-palette usage must migrate into editor-command-bar',
  )
  check(
    migrated['global-launcher']?.['host:legacy:global.open']?.count === 3,
    'global-launcher usage must continue to migrate in place',
  )
  check(
    !Object.hasOwn(migrated, 'command-palette'),
    'migrated usage must not preserve command-palette as an output bucket',
  )
} catch (error) {
  failures.push(`usage.ts migration contract failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (failures.length > 0) {
  console.error('✗ launcher host boundary contract failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('✓ test-launcher-host-boundaries passed')
