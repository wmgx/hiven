#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const packageJson = JSON.parse(read('package.json'))
assert.equal(
  packageJson.scripts?.['test:global-launcher-system-power-actions'],
  'node scripts/test-global-launcher-system-power-actions.mjs',
  'package.json must expose test:global-launcher-system-power-actions',
)

const hostProviderSource = read('src/workspace/launcher/hostProvider.ts')
const hostActionsSource = read('src/workspace/launcher/hostActions.ts')
const tauriSource = read('src-tauri/src/lib.rs')

assert.match(hostProviderSource, /getHostSystemPowerItems\(\)/, 'host provider should include system power actions')

for (const [key, zh, icon] of [
  ['host:system:restart', '重启', 'RotateCcw'],
  ['host:system:shutdown', '关机', 'Power'],
  ['host:system:lock-screen', '锁屏', 'Lock'],
]) {
  assert.match(hostActionsSource, new RegExp(`systemKey:\\s*['"]${key}['"]`), `${key} must be registered as a host launcher item`)
  assert.match(hostActionsSource, new RegExp(`titleI18n:\\s*\\{\\s*zh:\\s*['"]${zh}['"]\\s*\\}`), `${key} must have a Chinese title`)
  assert.match(hostActionsSource, new RegExp(`icon:\\s*['"]${icon}['"]`), `${key} must use the expected lucide icon`)
}

assert.match(hostActionsSource, /surfaces:\s*\[\s*['"]global-launcher['"]\s*\]/, 'system power actions should be global-launcher only')
assert.match(hostActionsSource, /invoke\(['"]perform_system_power_action['"][\s\S]*action/, 'system power actions should invoke the native command by action')
assert.doesNotMatch(hostActionsSource, /definePlugin|pluginRegistry/, 'system power actions must not be implemented as plugins')

assert.match(tauriSource, /enum\s+SystemPowerAction[\s\S]*Restart[\s\S]*Shutdown[\s\S]*LockScreen/, 'native side must model the allowed power actions')
assert.match(tauriSource, /fn\s+perform_system_power_action\(\s*action:\s*SystemPowerAction\s*\)\s*->\s*Result<\(\),\s*String>/, 'native command must expose perform_system_power_action')
assert.match(tauriSource, /perform_system_power_action,\s*\n/, 'native command must be registered in the Tauri invoke handler')
assert.match(tauriSource, /LockWorkStation|loginctl[\s\S]*lock-session/, 'non-macOS lock-screen command should use platform lock APIs')
assert.match(tauriSource, /macos_lock_screen\(\)/, 'macOS lock-screen command should use a dedicated fallback helper')
assert.match(tauriSource, /SACLockScreenImmediate/, 'macOS lock-screen command should prefer the native login.framework lock API')
assert.match(tauriSource, /dlopen[\s\S]*login\.framework[\s\S]*dlsym/, 'macOS lock-screen command should resolve private lock API at runtime')
assert.match(tauriSource, /macos_send_lock_screen_shortcut\(\)/, 'macOS lock-screen command should fall back to the native lock shortcut')
assert.match(tauriSource, /KEY_Q:\s*u16\s*=\s*12/, 'macOS lock shortcut should send the Q key')
assert.match(tauriSource, /CGEventFlagCommand[\s\S]*CGEventFlagControl|CGEventFlagControl[\s\S]*CGEventFlagCommand/, 'macOS lock shortcut should send Ctrl+Cmd+Q')
assert.doesNotMatch(tauriSource, /LockScreen[\s\S]{0,220}pmset[\s\S]{0,80}displaysleepnow/, 'lock-screen must not silently fall back to display sleep')

console.log('global launcher system power action checks passed')
