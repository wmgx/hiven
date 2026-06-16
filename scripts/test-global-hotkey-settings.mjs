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
  app: read('src/App.tsx'),
  globalPinnedLauncherHotkeys: read('src/hotkeys/globalPinnedLauncher.ts'),
  shortcutRecorder: read('src/components/ShortcutRecorder.tsx'),
  tauriHotkeys: read('src-tauri/src/hotkeys.rs'),
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

function assertDoesNotHave(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message)
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

check('default capability allows global shortcut register, unregister, and unregister_all', () => {
  const capability = JSON.parse(files.defaultCapability)
  assert.ok(
    capability.permissions?.includes('global-shortcut:allow-register'),
    'src-tauri/capabilities/default.json should allow global shortcut register',
  )
  assert.ok(
    capability.permissions?.includes('global-shortcut:allow-unregister'),
    'src-tauri/capabilities/default.json should allow global shortcut unregister',
  )
  assert.ok(
    capability.permissions?.includes('global-shortcut:allow-unregister-all'),
    'src-tauri/capabilities/default.json should allow global shortcut unregister_all so reload/HMR stale registrations can be cleared',
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

check('shortcut config supports accelerator, double-modifier, disabled, and all supported double modifiers', () => {
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
  assertDoesNotHave(
    files.store,
    /globalPinnedLauncherShortcut\?\.kind\s*===\s*['"]double-modifier['"][\s\S]{0,220}kind:\s*['"]accelerator['"]/,
    'persisted double-modifier shortcuts should not be migrated away from double-modifier support',
  )
})

for (const modifier of ['Command', 'Shift', 'Option']) {
  check(`store double-modifier shortcut supports ${modifier}`, () => {
    assertHas(
      files.store,
      new RegExp(`['"]${modifier}['"]`),
      `double-modifier variant should support ${modifier}`,
    )
  })
}

check('SettingsView renders a Hotkeys UI for the global pinned launcher shortcut', () => {
  assertHas(
    files.settingsView,
    /t\(['"]hotkeys['"]\)|settings\.hotkeys|Hotkeys|快捷键/,
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

check('SettingsView supports recording, disabled, and status display', () => {
  assertHas(
    files.shortcutRecorder,
    /recordingShortcut|recordShortcut|isRecording|onKeyDown[\s\S]{0,240}accelerator/,
    'ShortcutRecorder should support recording an accelerator',
  )
  assertHas(
    `${files.settingsView}\n${files.shortcutRecorder}`,
    /disabled|settings\.hotkeyDisabled|禁用/,
    'SettingsView should expose a disabled option',
  )
  assertHas(
    files.settingsView,
    /registrationStatus|registerStatus|statusText|settings\.hotkeyStatus/,
    'SettingsView should show registration status or error text',
  )
  assertDoesNotHave(
    files.settingsView,
    /shortcut\.registrationStatus\s*\?\?\s*t\(['"]hotkeyStatusPending['"]\)/,
    'SettingsView should not render native registration status strings without i18n formatting',
  )
  assertHas(
    files.settingsView,
    /formatHotkeyRegistrationStatus/,
    'SettingsView should localize native registration status strings before rendering',
  )
})

for (const modifier of ['Command', 'Shift', 'Option']) {
  check(`ShortcutRecorder can record Double ${modifier}`, () => {
    assertHas(
      files.shortcutRecorder,
      new RegExp(`['"]${modifier}['"]`),
      `ShortcutRecorder should be able to record Double ${modifier}`,
    )
  })
}

check('Settings recording path can identify modifier-only double-modifier shortcuts', () => {
  assertHas(
    files.shortcutRecorder,
    /eventTo(?:ShortcutRecorderValue|GlobalPinnedLauncherShortcut|Shortcut|DoubleModifierShortcut|RecordedShortcut)\s*\(/,
    'recording should route key events through a testable shortcut helper, not only a private accelerator formatter',
  )
  assertHas(
    files.shortcutRecorder,
    /event\.key\s*===\s*['"](?:Meta|Shift|Alt|Option)['"][\s\S]{0,420}kind:\s*['"]double-modifier['"]|kind:\s*['"]double-modifier['"][\s\S]{0,420}event\.key\s*===\s*['"](?:Meta|Shift|Alt|Option)['"]|isModifierKey\(event\.key\)[\s\S]{0,640}kind:\s*['"]double-modifier['"]/,
    'recording should convert modifier-only key events into double-modifier shortcut configs',
  )
  assertHas(
    `${files.settingsView}\n${files.shortcutRecorder}`,
    /onRecord=\{onChange\}|onChange\(\s*(?:recordedShortcut(?:\.shortcut)?|shortcut|nextShortcut)\s*\)/,
    'recording handler should pass the recorded accelerator or double-modifier shortcut through onChange',
  )
})

check('Settings double-modifier labels adapt to the current platform', () => {
  assertHas(
    files.shortcutRecorder,
    /getHotkeyPlatformLabels/,
    'ShortcutRecorder should derive platform-specific hotkey labels',
  )
  assertHas(
    files.shortcutRecorder,
    /command:\s*isMac\s*\?\s*['"]Cmd['"]\s*:\s*['"]Ctrl['"]/,
    'ShortcutRecorder should display Ctrl instead of Cmd on non-macOS platforms',
  )
  assertHas(
    files.shortcutRecorder,
    /option:\s*isMac\s*\?\s*['"]Option['"]\s*:\s*['"]Alt['"]/,
    'ShortcutRecorder should display Alt instead of Option on non-macOS platforms',
  )
  assertHas(
    files.shortcutRecorder,
    /event\.key\s*===\s*['"]Control['"][\s\S]{0,120}!isMacPlatform\(\)[\s\S]{0,120}['"]Command['"]/,
    'ShortcutRecorder should allow double Ctrl recording to use the primary double-modifier slot on non-macOS platforms',
  )
})

check('ShortcutRecorder still records modifier+Space accelerators (e.g. Cmd+Space / Option+Space)', () => {
  assertHas(
    files.shortcutRecorder,
    /key === ['"] ['"]|key === ['"]Space['"]|event\.code === ['"]Space['"]|normalizeKey/,
    'ShortcutRecorder should handle the Space key so Cmd+Space / Option+Space can be recorded',
  )
})

check('native double-modifier hotkey layer supports Command, Shift, and Option', () => {
  assertHas(
    files.tauriHotkeys,
    /register_double_modifier_hotkey/,
    'native hotkey command should accept a modifier argument instead of only registering Double Cmd',
  )
  for (const modifier of ['Command', 'Shift', 'Option']) {
    assertHas(
      files.tauriHotkeys,
      new RegExp(`['"]${modifier}['"]|\\b${modifier}\\b`),
      `native double-modifier detector should model ${modifier}`,
    )
  }
  assertDoesNotHave(
    files.tauriHotkeys,
    /start_double_cmd_listener|DoubleCmdHotkeyState|Key::Meta|meta_was_down|Modifiers\s*\{\s*meta:/,
    'native double-modifier listener should not retain Cmd-only detector symbols after adding Shift and Option',
  )
})

check('native double-modifier registration requests macOS Accessibility trust', () => {
  assertHas(
    files.tauriHotkeys,
    /AXIsProcessTrustedWithOptions/,
    'native double-modifier registration should ask macOS for Accessibility trust before creating the event tap',
  )
  assertHas(
    files.tauriHotkeys,
    /AXTrustedCheckOptionPrompt/,
    'native Accessibility trust check should request the system prompt for GitHub/release installs',
  )
  assertHas(
    files.tauriHotkeys,
    /Accessibility permission is required for double-modifier global shortcuts/,
    'native hotkey status should expose a recognizable Accessibility failure',
  )
})

check('App global keydown handler ignores shortcut recorder events', () => {
  assertHas(
    files.app,
    /is(?:Global)?ShortcutRecordingEvent|isHotkeyRecordingEvent|data-(?:shortcut|hotkey)-recorder|__FLUXTEXT_HOTKEY_RECORDING__/,
    'App should be able to identify active Settings shortcut recording events',
  )
  assertHas(
    files.app,
    /if\s*\([^)]*(?:is(?:Global)?ShortcutRecordingEvent|isHotkeyRecordingEvent|data-(?:shortcut|hotkey)-recorder|__FLUXTEXT_HOTKEY_RECORDING__)[\s\S]{0,160}return/,
    'App keydown capture handler should return before opening launchers/palette while Settings is recording',
  )
})

check('global shortcut sync only unregisters its own configured accelerator', () => {
  assertDoesNotHave(
    files.globalPinnedLauncherHotkeys,
    /unregisterAll\s*\(/,
    'global pinned launcher sync must not unregister plugin surface shortcuts',
  )
  assertHas(
    files.globalPinnedLauncherHotkeys,
    /await\s+unregisterCurrentAccelerator\(\)/,
    'sync startup should unregister only the previous pinned launcher accelerator before registering the configured accelerator',
  )
})

check('i18n includes English and Chinese copy for the hotkey settings', () => {
  for (const key of [
    'globalPinnedLauncherShortcut',
    'globalPinnedLauncherShortcutInfo',
    'hotkeyRecord',
    'hotkeyDoubleCmd',
    'hotkeyDisabled',
    'hotkeyStatus',
    'hotkeyDoubleModifier',
    'hotkeyStatusDoubleRegistered',
    'hotkeyRegistrationFailed',
    'hotkeyAccessibilityRequired',
    'hotkeyDoubleModifierUnsupported',
  ]) {
    assertHas(files.i18n, new RegExp(`['"]${key}['"]`), `i18n should include ${key}`)
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

for (const key of ['hotkeyDoubleShift', 'hotkeyDoubleOption']) {
  check(`i18n includes ${key}`, () => {
    assertHas(files.i18n, new RegExp(`['"]${key}['"]`), `i18n should include ${key}`)
  })
}

if (failures.length > 0) {
  console.error(`global hotkey settings checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('global hotkey settings checks passed')
