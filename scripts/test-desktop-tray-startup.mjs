#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const tauriLib = read('src-tauri/src/lib.rs')
const cargoToml = read('src-tauri/Cargo.toml')
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))

assert.match(cargoToml, /tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"tray-icon"/s, 'Tauri must enable the tray-icon feature')
assert.match(tauriLib, /use\s+tauri::tray::TrayIconBuilder;/, 'native runtime must import Tauri tray support')
assert.match(tauriLib, /fn\s+configure_desktop_tray\(/, 'native runtime must configure a desktop tray icon during setup')
assert.match(tauriLib, /TrayIconBuilder::with_id\("hiven-tray"\)/, 'tray icon must have a stable id')
assert.match(tauriLib, /\.tooltip\("Hiven"\)/, 'tray icon must expose the product tooltip')
assert.match(tauriLib, /\.show_menu_on_left_click\(true\)/, 'tray menu must open from the primary click')
assert.match(tauriLib, /"tray-open-launcher"[\s\S]*desktop_tray_text\("open"\)/, 'tray menu must include a localized Open Hiven action')
assert.match(tauriLib, /"tray-quit"[\s\S]*desktop_tray_text\("quit"\)/, 'tray menu must include a localized Quit Hiven action')
assert.match(tauriLib, /fn\s+desktop_tray_text\([\s\S]*"打开 Hiven"[\s\S]*"退出 Hiven"[\s\S]*"Open Hiven"[\s\S]*"Quit Hiven"/, 'tray menu copy must provide Chinese and English labels')
assert.match(tauriLib, /event\.id\(\)\.as_ref\(\)[\s\S]*"tray-open-launcher"[\s\S]*show_launcher_window_for_hotkey/, 'Open Hiven tray action must show the launcher')
assert.match(tauriLib, /event\.id\(\)\.as_ref\(\)[\s\S]*"tray-quit"[\s\S]*app\.exit\(0\)/, 'Quit Hiven tray action must exit the app')
assert.match(tauriLib, /set_activation_policy\(tauri::ActivationPolicy::Accessory\)/, 'macOS startup must use accessory activation policy to stay out of the Dock')
assert.match(tauriLib, /\.setup\(\|app\|[\s\S]*configure_desktop_tray\(app\)\?/, 'setup must install the tray before app startup completes')
assert.equal(tauriConfig.app.windows.find((window) => window.label === 'launcher')?.skipTaskbar, true, 'launcher runtime window must stay hidden from Windows taskbar')

console.log('desktop tray startup checks passed')
