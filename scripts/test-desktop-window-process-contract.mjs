#!/usr/bin/env node
/**
 * Source contract: package ④ windows + package ⑤ processes.
 * Covers command names, deny list, empty-query process gate, L2 choices,
 * TTL cache helpers, host provider merge, and permission keys.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

assert.ok(existsSync(join(root, 'src/workspace/desktopControl/windows.ts')), 'windows host module must exist')
assert.ok(existsSync(join(root, 'src/workspace/desktopControl/processes.ts')), 'processes host module must exist')
assert.ok(existsSync(join(root, 'src/workspace/desktopControl/audit.ts')), 'audit module must exist')

const files = {
  tauriLib: read('src-tauri/src/lib.rs'),
  windows: read('src/workspace/desktopControl/windows.ts'),
  processes: read('src/workspace/desktopControl/processes.ts'),
  audit: read('src/workspace/desktopControl/audit.ts'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  pluginPermissions: read('src/workspace/pluginPermissions.ts'),
  launcherTypes: read('src/workspace/launcher/types.ts'),
  packageJson: read('package.json'),
}

// ── Rust commands ────────────────────────────────────────────────────────────
for (const name of [
  'list_desktop_windows',
  'focus_desktop_window',
  'close_desktop_window',
  'list_desktop_processes',
  'terminate_desktop_process',
]) {
  assert.match(files.tauriLib, new RegExp(`fn ${name}\\b`), `Rust must define ${name}`)
  assert.match(files.tauriLib, new RegExp(`\\b${name},`), `invoke_handler must register ${name}`)
}

assert.match(files.tauriLib, /struct DesktopWindow/, 'Rust must define DesktopWindow')
assert.match(files.tauriLib, /struct DesktopProcess/, 'Rust must define DesktopProcess')
assert.match(files.tauriLib, /DESKTOP_PROCESS_DENY_NAMES/, 'Rust must define process deny list')
assert.match(files.tauriLib, /is_denied_desktop_process_name/, 'Rust must expose deny helper')

for (const denied of [
  'kernel_task',
  'launchd',
  'windowserver',
  'loginwindow',
  'systemuiserver',
  'cfprefsd',
  'opendirectoryd',
  'securityd',
]) {
  assert.match(
    files.tauriLib,
    new RegExp(`"${denied}"`, 'i'),
    `deny list must include ${denied}`,
  )
}

assert.match(files.tauriLib, /SIGTERM|"-TERM"|-TERM/, 'terminate must prefer soft SIGTERM')
assert.match(files.tauriLib, /-9|SIGKILL|force/, 'terminate must support force path')
assert.match(
  files.tauriLib,
  /list_desktop_processes[\s\S]{0,400}is_none\(\)[\s\S]{0,120}Ok\(Vec::new\(\)\)|if q\.is_none\(\)[\s\S]{0,80}Ok\(Vec::new\(\)\)/,
  'empty process query must return empty list',
)
assert.match(files.tauriLib, /desktop_process_deny_tests/, 'Rust unit tests for deny list required')
assert.match(files.tauriLib, /deny_list_blocks_critical_system_process_names/, 'deny unit test required')

// ── TS windows ───────────────────────────────────────────────────────────────
assert.match(files.windows, /WINDOW_LIST_TTL_MS\s*=\s*2000/, 'window list TTL must be 2s')
assert.match(files.windows, /listDesktopWindowsCached|windowListCache/, 'window TTL cache helper required')
assert.match(files.windows, /getHostWindowLauncherDynamicItems/, 'window dynamic items provider required')
assert.match(files.windows, /host\.window:focus:native:\$\{/, 'focus systemKey required')
assert.match(files.windows, /host\.window:close:native:\$\{/, 'close systemKey required')
assert.match(files.windows, /kindLabelI18n/, 'window kindLabel i18n required')
assert.match(files.processes, /isProcessModeQuery/, 'process mode gate required')
assert.match(files.processes, /recordUsage:\s*false/, 'process items must not record usage')
assert.match(files.windows, /invoke\(['"]list_desktop_windows['"]\)/, 'windows must invoke list_desktop_windows')
assert.match(files.windows, /invoke\(['"]focus_desktop_window['"]/, 'windows must invoke focus')
assert.match(files.windows, /invoke\(['"]close_desktop_window['"]/, 'windows must invoke close')
assert.match(files.windows, /stripWindowQueryPrefix/, 'window prefix strip helper required')
assert.match(files.windows, /切到|focus|窗口/, 'window aliases / prefixes required')
assert.match(files.windows, /confirm-close-window|Confirm close|确认关闭/, 'close L2 confirm choice required')
assert.match(files.windows, /cancel-close-window|Cancel|取消/, 'close L2 cancel choice required')
assert.match(files.windows, /titleI18n/, 'window items must use titleI18n')
assert.match(files.windows, /EMPTY_QUERY_WINDOW_LIMIT\s*=\s*8/, 'empty query window cap')
assert.match(files.windows, /auditL2Action/, 'close confirm must audit L2')
// Primary execute focuses; close returns choices (never direct close without confirm)
assert.match(
  files.windows,
  /execute:\s*async\s*\(\)\s*=>\s*buildCloseConfirmResult/,
  'close item execute must return L2 choices, not direct close',
)
assert.doesNotMatch(
  files.windows,
  /execute:\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,80}closeDesktopWindow/,
  'close must not execute without L2 choices',
)

// ── TS processes primitives ──────────────────────────────────────────────────
assert.match(files.processes, /PROCESS_LIST_TTL_MS\s*=\s*2000/, 'process list TTL must be 2s')
assert.match(files.processes, /listDesktopProcessesCached|processListCache/, 'process TTL cache helper required')
assert.match(files.processes, /invoke\(['"]list_desktop_processes['"]/, 'processes must invoke list')
// First-level dynamic process rows removed (collect-input command owns UX)
assert.match(
  files.processes,
  /return\s*\[\]/,
  'getHostProcessLauncherDynamicItems must not emit first-level rows',
)

// ── Kill command = collect-input second level (same as web-open) ─────────────
const killCmd = readFileSync('src/workspace/desktopControl/killProcessCommand.ts', 'utf8')
assert.match(killCmd, /host:process:kill-command/, 'stable kill command systemKey')
assert.match(killCmd, /type:\s*'collect-input'/, 'kill must use collect-input second level')
assert.match(killCmd, /suggest:\s*async/, 'kill must suggest process list on second level')
assert.match(killCmd, /confirm-terminate-process|确认结束/, 'L2 confirm required')
assert.match(killCmd, /cancel-terminate-process|取消/, 'L2 cancel required')
assert.match(killCmd, /terminate_desktop_process/, 'must invoke terminate')
assert.match(killCmd, /force.*false|false\s*\/\* soft/, 'default soft terminate')
// Soft terminate
assert.match(killCmd, /terminateDesktopProcess\(proc\.pid,\s*false\)/, 'default terminate soft')

// ── Audit ────────────────────────────────────────────────────────────────────
assert.match(files.audit, /export function auditL2Action/, 'auditL2Action export required')
assert.match(files.audit, /targetSummary/, 'audit records target summary')
assert.doesNotMatch(files.audit, /clipboard\.content|clipboardText|pasteText/, 'audit must not log clipboard body')

// ── Host provider ────────────────────────────────────────────────────────────
assert.match(files.hostProvider, /getHostWindowLauncherDynamicItems/, 'host provider must wire windows')
assert.match(files.hostProvider, /getHostAppLauncherDynamicItems/, 'host provider must keep apps')
assert.match(files.hostProvider, /getKillProcessHostItem/, 'host must register kill as static collect-input command')
assert.doesNotMatch(
  files.hostProvider,
  /getHostProcessLauncherDynamicItems/,
  'host must not put processes on first-level dynamic list',
)

// ── Permissions ──────────────────────────────────────────────────────────────
assert.match(files.pluginTypes, /'desktop\.windows'/, 'PluginPermission must include desktop.windows')
assert.match(files.pluginTypes, /'desktop\.processes'/, 'PluginPermission must include desktop.processes')
assert.match(
  files.pluginPermissions,
  /ALL_PLUGIN_PERMISSIONS[\s\S]*'desktop\.windows'/,
  'ALL must include desktop.windows',
)
assert.match(
  files.pluginPermissions,
  /ALL_PLUGIN_PERMISSIONS[\s\S]*'desktop\.processes'/,
  'ALL must include desktop.processes',
)
assert.match(
  files.pluginPermissions,
  /'desktop\.windows'\s*:\s*\{\s*en:\s*'[^']+'\s*,\s*zh:\s*'[^']+'\s*\}/,
  'desktop.windows labels en/zh required',
)
assert.match(
  files.pluginPermissions,
  /'desktop\.processes'\s*:\s*\{\s*en:\s*'[^']+'\s*,\s*zh:\s*'[^']+'\s*\}/,
  'desktop.processes labels en/zh required',
)

// Capabilities for host items
assert.match(files.launcherTypes, /'desktop-windows'/, 'LauncherHostCapability desktop-windows required')
assert.match(files.launcherTypes, /'desktop-processes'/, 'LauncherHostCapability desktop-processes required')
assert.match(
  files.launcherTypes,
  /'global-launcher'[\s\S]*'desktop-windows'[\s\S]*'desktop-processes'/,
  'global-launcher must advertise desktop capabilities',
)

// package.json script
assert.match(
  files.packageJson,
  /"test:desktop-window-process-contract"\s*:\s*"node scripts\/test-desktop-window-process-contract\.mjs"/,
  'package.json must expose contract test script',
)

console.log('desktop window/process contract checks passed')
