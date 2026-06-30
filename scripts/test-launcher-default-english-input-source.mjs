#!/usr/bin/env node
/** Launcher temporary English input source with restore contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')
assert.match(rust, /static PREVIOUS_LAUNCHER_INPUT_SOURCE_ID/, 'native layer should remember previous launcher input source')
assert.match(rust, /fn switch_to_default_english_input_source\(/, 'native layer should expose a best-effort temporary English input source switch')
assert.match(rust, /com\.apple\.keylayout\.ABC/, 'macOS temporary English source should prefer ABC layout')
assert.match(rust, /TISCopyCurrentKeyboardInputSource/, 'macOS implementation should capture current input source before switching')
assert.match(rust, /TISSelectInputSource/, 'macOS implementation should use Text Input Source APIs')
assert.match(rust, /fn restore_launcher_previous_input_source\(/, 'native layer should restore previous input source on close')
assert.match(rust, /show_launcher_window_for_hotkey[\s\S]*switch_to_default_english_input_source/, 'launcher open path should switch input source before focusing query')
assert.match(rust, /hide_launcher_window[\s\S]*restore_launcher_previous_input_source/, 'launcher close path should restore previous input source')

const targets = [
  ['GlobalLauncherSearchFrame', 'src/components/launcher/GlobalLauncherSearchFrame.tsx'],
  ['LauncherDomainSearchStep', 'src/components/launcher/LauncherDomainSearchStep.tsx'],
  ['EditorCommandBarHost', 'src/launcher/hosts/EditorCommandBarHost.tsx'],
]

for (const [name, path] of targets) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /inputMode="latin"/, `${name} should keep a soft latin input hint`)
  assert.doesNotMatch(source, /sanitizeLauncherLatinQuery|isLauncherLatinText/, `${name} must not block Chinese input`)
}

console.log('launcher temporary English input source restore checks passed')
