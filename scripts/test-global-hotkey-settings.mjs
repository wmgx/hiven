#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readI18n() {
  const dir = join(root, 'src/i18n/locales')
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n')
}

const files = {
  packageJson: read('package.json'),
  cargoToml: read('src-tauri/Cargo.toml'),
  tauriLib: read('src-tauri/src/lib.rs'),
  defaultCapability: read('src-tauri/capabilities/default.json'),
  store: read('src/store.ts'),
  settingsView: read('src/views/SettingsView.tsx'),
  i18n: readI18n(),
}

const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

check('package.json exposes the global hotkey settings verifier', () => {
  const packageJson = JSON.parse(files.packageJson)
  assert.equal(
    packageJson.scripts?.['test:global-hotkey-settings'],
    'node scripts/test-global-hotkey-settings.mjs',
    'package.json should expose test:global-hotkey-settings',
  )
})

check('Tauri global shortcut dependencies are declared', () => {
  const packageJson = JSON.parse(files.packageJson)
  assert.ok(
    packageJson.dependencies?.['@tauri-apps/plugin-global-shortcut'] ||
      packageJson.devDependencies?.['@tauri-apps/plugin-global-shortcut'],
    'package.json should include @tauri-apps/plugin-global-shortcut',
  )
  assertHas(
    files.cargoToml,
    /tauri-plugin-global-shortcut\s*=/,
    'src-tauri/Cargo.toml should include tauri-plugin-global-shortcut',
  )
})

check('Tauri app registers the global shortcut plugin', () => {
  assertHas(
    files.tauriLib,
    /\.plugin\(\s*tauri_plugin_global_shortcut::/,
    'src-tauri/src/lib.rs should register tauri_plugin_global_shortcut',
  )
})

check('default capability allows global shortcut register and unregister', () => {
  const capability = JSON.parse(files.defaultCapability)
  assert.ok(
    capability.permissions?.includes('global-shortcut:allow-register'),
    'src-tauri/capabilities/default.json should allow global shortcut register',
  )
  assert.ok(
    capability.permissions?.includes('global-shortcut:allow-unregister'),
    'src-tauri/capabilities/default.json should allow global shortcut unregister',
  )
})

check('frontend global pinned launcher hotkey coordinator exists', () => {
  assert.ok(
    existsSync(join(root, 'src/hotkeys/globalPinnedLauncher.ts')),
    'src/hotkeys/globalPinnedLauncher.ts should coordinate global pinned launcher hotkeys',
  )
})

check('store settings include a single global pinned launcher shortcut config', () => {
  assertHas(
    files.store,
    /GlobalPinnedLauncherShortcut|globalPinnedLauncherShortcut\s*:/,
    'store should model globalPinnedLauncherShortcut',
  )
  assertHas(
    files.store,
    /settings:\s*\{[\s\S]*globalPinnedLauncherShortcut\s*:/,
    'settings should persist globalPinnedLauncherShortcut',
  )
})

check('shortcut config supports accelerator, double-modifier, and disabled variants', () => {
  for (const kind of ['accelerator', 'double-modifier', 'disabled']) {
    assertHas(
      files.store,
      new RegExp(`['"]${kind}['"]`),
      `GlobalPinnedLauncherShortcut should support ${kind}`,
    )
  }
  assertHas(
    files.store,
    /accelerator\s*:\s*string|value\s*:\s*string|shortcut\s*:\s*string/,
    'accelerator variant should carry the configured shortcut string',
  )
  assertHas(
    files.store,
    /modifier\s*:\s*['"](?:Meta|Command|Cmd)['"]|doubleModifier\s*:\s*['"](?:Meta|Command|Cmd)['"]/,
    'double-modifier variant should identify the Command modifier',
  )
})

check('SettingsView renders a Hotkeys UI for the global pinned launcher shortcut', () => {
  assertHas(
    files.settingsView,
    /settings\.hotkeys|Hotkeys|快捷键/,
    'SettingsView should render a Hotkeys card',
  )
  assertHas(
    files.settingsView,
    /globalPinnedLauncherShortcut/,
    'SettingsView should read and update globalPinnedLauncherShortcut',
  )
  assertHas(
    files.settingsView,
    /settings\.globalPinnedLauncherShortcut|settings\.openPinnedLauncherShortcut|pinned-only|Pinned Launcher|固定命令启动器/,
    'SettingsView should label the global pinned launcher shortcut control',
  )
})

check('SettingsView supports recording, Double Cmd, disabled, and status display', () => {
  assertHas(
    files.settingsView,
    /recordingShortcut|recordShortcut|isRecording|onKeyDown[\s\S]{0,240}accelerator/,
    'SettingsView should support recording an accelerator',
  )
  assertHas(
    files.settingsView,
    /Double Cmd|Double Command|double-modifier|双击\s*(?:Cmd|Command|⌘)/,
    'SettingsView should expose a Double Cmd option',
  )
  assertHas(
    files.settingsView,
    /disabled|settings\.hotkeyDisabled|禁用/,
    'SettingsView should expose a disabled option',
  )
  assertHas(
    files.settingsView,
    /registrationStatus|registerStatus|statusText|settings\.hotkeyStatus/,
    'SettingsView should show registration status or error text',
  )
})

check('i18n includes English and Chinese copy for the hotkey settings', () => {
  for (const key of [
    'settings.globalPinnedLauncherShortcut',
    'settings.globalPinnedLauncherShortcutInfo',
    'settings.hotkeyRecord',
    'settings.hotkeyDoubleCmd',
    'settings.hotkeyDisabled',
    'settings.hotkeyStatus',
  ]) {
    assertHas(files.i18n, new RegExp(key.replaceAll('.', '\\.')), `i18n should include ${key}`)
  }
  assertHas(
    files.i18n,
    /Global pinned launcher|Pinned-only launcher|Open pinned launcher/,
    'English i18n should describe the global pinned launcher shortcut',
  )
  assertHas(
    files.i18n,
    /全局固定命令启动器|固定命令启动器|只显示固定/,
    'Chinese i18n should describe the global pinned launcher shortcut',
  )
})

if (failures.length > 0) {
  console.error(`global hotkey settings checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('global hotkey settings checks passed')
