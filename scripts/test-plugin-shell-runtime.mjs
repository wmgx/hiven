#!/usr/bin/env node

/**
 * Host shell.run runtime contract tests (static source + assert.match).
 * Mirrors scripts/test-plugin-network-proxy.mjs style.
 *
 * Collects all failures so implementers see the full checklist in one run.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')
const readOptional = (path) => {
  const full = join(root, path)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

const files = {
  packageJson: read('package.json'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  launcherTypes: read('src/workspace/launcher/types.ts'),
  pluginShell: readOptional('src/workspace/pluginShell.ts'),
  tauriLib: read('src-tauri/src/lib.rs'),
  pluginHookManager: read('src/workspace/pluginHookManager.ts'),
  pluginBackgroundManager: read('src/workspace/pluginBackgroundManager.ts'),
  pluginSettingsDialog: read('src/components/PluginSettingsDialog.tsx'),
  pluginSurfaceRenderer: read('src/components/pluginSurface/PluginSurfaceRenderer.tsx'),
  launcherRegistry: read('src/workspace/launcher/registry.ts'),
  pluginSdk: read('src/plugin-sdk.ts'),
}

const failures = []

function check(label, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 1. package.json exposes test:plugin-shell-runtime
check('1. package.json script', () => {
  assert.equal(
    JSON.parse(files.packageJson).scripts?.['test:plugin-shell-runtime'],
    'node scripts/test-plugin-shell-runtime.mjs',
    'package.json must expose test:plugin-shell-runtime',
  )
})

// 2. pluginTypes: PluginShellApi, ShellRunOptions, ShellRunResult, 'shell.run'
check('2. PluginShellApi type', () => {
  assert.match(files.pluginTypes, /PluginShellApi/, 'pluginTypes must define PluginShellApi')
})
check('2. ShellRunOptions type', () => {
  assert.match(files.pluginTypes, /ShellRunOptions/, 'pluginTypes must define ShellRunOptions')
})
check('2. ShellRunResult type', () => {
  assert.match(files.pluginTypes, /ShellRunResult/, 'pluginTypes must define ShellRunResult')
})
check("2. 'shell.run' permission", () => {
  assert.match(files.pluginTypes, /'shell\.run'/, "pluginTypes PluginPermission must include 'shell.run'")
})

// 3. Context types expose shell: PluginShellApi (or shell:)
// PluginStartupHookContext / PluginBackgroundContext / PluginSurfaceHostApi live in pluginTypes
// LauncherDynamicContext lives in launcher/types
const contextSources = {
  PluginStartupHookContext: files.pluginTypes,
  PluginBackgroundContext: files.pluginTypes,
  PluginSurfaceHostApi: files.pluginTypes,
  LauncherDynamicContext: files.launcherTypes,
}

for (const [name, source] of Object.entries(contextSources)) {
  check(`3. ${name}.shell`, () => {
    const typeBlock =
      source.match(new RegExp(`export\\s+type\\s+${name}\\b[\\s\\S]*?\\n\\}`, 'm'))?.[0] ?? ''
    assert.ok(typeBlock, `${name} type definition must exist`)
    assert.match(
      typeBlock,
      /shell:\s*PluginShellApi|shell:/,
      `${name} must expose shell: PluginShellApi (or shell:)`,
    )
  })
}

// 4. pluginShell.ts exists with createPluginShell / requirePluginPermissions / shell.run / plugin_shell_run
check('4. pluginShell.ts exists', () => {
  assert.ok(
    existsSync(join(root, 'src/workspace/pluginShell.ts')),
    'src/workspace/pluginShell.ts must exist',
  )
})
check('4. createPluginShell', () => {
  assert.match(files.pluginShell, /createPluginShell/, 'pluginShell must export createPluginShell')
})
check('4. requirePluginPermissions', () => {
  assert.match(
    files.pluginShell,
    /requirePluginPermissions/,
    'pluginShell must call requirePluginPermissions',
  )
})
check('4. shell.run gate', () => {
  assert.match(
    files.pluginShell,
    /shell\.run|'shell\.run'/,
    "pluginShell must gate on shell.run permission",
  )
})
check('4. plugin_shell_run invoke', () => {
  assert.match(
    files.pluginShell,
    /plugin_shell_run/,
    "pluginShell must invoke 'plugin_shell_run'",
  )
})

// 5. Tauri plugin_shell_run command registered in generate_handler!
check('5. plugin_shell_run fn', () => {
  assert.match(
    files.tauriLib,
    /fn\s+plugin_shell_run\b|async\s+fn\s+plugin_shell_run\b/,
    'src-tauri/src/lib.rs must define plugin_shell_run',
  )
})
check('5. generate_handler registration', () => {
  assert.match(
    files.tauriLib,
    /generate_handler!\[[\s\S]*plugin_shell_run/,
    'plugin_shell_run must be registered in generate_handler!',
  )
})

// 6. pluginHookManager injects shell: createPluginShell
check('6. pluginHookManager createPluginShell', () => {
  assert.match(
    files.pluginHookManager,
    /createPluginShell/,
    'pluginHookManager must import/use createPluginShell',
  )
})
check('6. pluginHookManager shell inject', () => {
  assert.match(
    files.pluginHookManager,
    /shell:\s*createPluginShell/,
    'pluginHookManager must inject shell: createPluginShell',
  )
})

// 7. pluginBackgroundManager injects shell
check('7. pluginBackgroundManager createPluginShell', () => {
  assert.match(
    files.pluginBackgroundManager,
    /createPluginShell/,
    'pluginBackgroundManager must import/use createPluginShell',
  )
})
check('7. pluginBackgroundManager shell inject', () => {
  assert.match(
    files.pluginBackgroundManager,
    /shell:\s*createPluginShell/,
    'pluginBackgroundManager must inject shell: createPluginShell',
  )
})

// 8. PluginSettingsDialog (or settings host) injects shell
check('8. PluginSettingsDialog shell presence', () => {
  assert.match(
    files.pluginSettingsDialog,
    /createPluginShell/,
    'PluginSettingsDialog / settings host must use createPluginShell',
  )
})
check('8. PluginSettingsDialog shell inject', () => {
  assert.match(
    files.pluginSettingsDialog,
    /shell:\s*createPluginShell|shell:\s*\w*[Ss]hell/,
    'PluginSettingsDialog must pass shell into settings onChange / host context',
  )
})

// 9. PluginSurfaceRenderer injects shell
check('9. PluginSurfaceRenderer createPluginShell', () => {
  assert.match(
    files.pluginSurfaceRenderer,
    /createPluginShell/,
    'PluginSurfaceRenderer must import/use createPluginShell',
  )
})
check('9. PluginSurfaceRenderer shell inject', () => {
  assert.match(
    files.pluginSurfaceRenderer,
    /shell:\s*createPluginShell/,
    'PluginSurfaceRenderer must inject shell: createPluginShell',
  )
})

// 10. launcher/registry.ts injects shell
check('10. launcher/registry createPluginShell', () => {
  assert.match(
    files.launcherRegistry,
    /createPluginShell/,
    'launcher/registry must import/use createPluginShell',
  )
})
check('10. launcher/registry shell inject', () => {
  assert.match(
    files.launcherRegistry,
    /shell:\s*createPluginShell/,
    'launcher/registry must inject shell: createPluginShell',
  )
})

// 11. plugin-sdk exports PluginShellApi related types
check('11. plugin-sdk PluginShellApi export', () => {
  assert.match(
    files.pluginSdk,
    /PluginShellApi/,
    'plugin-sdk must export PluginShellApi',
  )
})
check('11. plugin-sdk shell type exports', () => {
  assert.match(
    files.pluginSdk,
    /ShellRunOptions/,
    'plugin-sdk must export ShellRunOptions',
  )
  assert.match(
    files.pluginSdk,
    /ShellRunResult/,
    'plugin-sdk must export ShellRunResult',
  )
})

// 12. pluginHookManager retries startup after permissions are granted
// (subscribe / runPluginStartupHooks / permission-related retry)
check('12. pluginHookManager permission subscribe', () => {
  assert.match(
    files.pluginHookManager,
    /subscribe/,
    'pluginHookManager must subscribe (permission watcher) to retry startup after grants',
  )
})
check('12. pluginHookManager permission store wiring', () => {
  assert.match(
    files.pluginHookManager,
    /usePluginPermissionStore/,
    'pluginHookManager must use usePluginPermissionStore for permission-change retry',
  )
})
check('12. pluginHookManager startup retry path', () => {
  assert.match(
    files.pluginHookManager,
    /runPluginStartupHooks/,
    'pluginHookManager must expose/run runPluginStartupHooks for retry',
  )
  // After permissions are filled, incomplete startup hooks should be re-attempted
  // (mirror background permission watcher: missing→complete restart).
  assert.match(
    files.pluginHookManager,
    /missingPluginPermissions|setup.*Permission|permission.*watch|watch.*permission/i,
    'pluginHookManager must retry startup when permissions become complete',
  )
})

if (failures.length > 0) {
  console.error(`plugin shell runtime checks FAILED (${failures.length}):`)
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exit(1)
}

console.log('plugin shell runtime checks passed')
