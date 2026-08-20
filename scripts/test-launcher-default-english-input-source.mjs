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

// LauncherDomainSearchStep and EditorCommandBarHost were deleted in the workbench
// retirement (6e69f0f); the launcher search frame is the only query input left.
const targets = [
  ['GlobalLauncherSearchFrame', 'src/components/launcher/GlobalLauncherSearchFrame.tsx'],
]

for (const [name, path] of targets) {
  const source = readFileSync(path, 'utf8')
  // The English bias is a hint, not a lock: it lives in lang/autoCorrect/spellCheck
  // and the native input-source switch above, never in query sanitization.
  assert.match(source, /lang="en"/, `${name} should keep a soft English input hint`)
  assert.doesNotMatch(source, /sanitizeLauncherLatinQuery|isLauncherLatinText/, `${name} must not block Chinese input`)
}

console.log('launcher temporary English input source restore checks passed')
