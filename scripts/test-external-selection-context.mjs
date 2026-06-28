#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  refactorSuite: read('scripts/test-refactor-suite.mjs'),
  tauriLib: read('src-tauri/src/lib.rs'),
  contextBroker: read('src/launcher/context/contextBroker.ts'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:external-selection-context'],
  'node scripts/test-external-selection-context.mjs',
  'package.json must expose external selection context coverage',
)
assert.match(files.refactorSuite, /test:external-selection-context/, 'refactor suite must include external selection context coverage')
assert.match(files.tauriLib, /static\s+LAST_FOREGROUND_SELECTION_TEXT/, 'native runtime must keep a short-lived foreground selection cache')
assert.match(files.tauriLib, /fn\s+capture_foreground_selection_text/, 'native runtime must attempt to capture selected text before showing launcher')
assert.match(files.tauriLib, /remember_previous_foreground_app\(\)[\s\S]{0,240}capture_foreground_selection_text\(&app_clone\)/, 'launcher hotkey path must capture selection immediately after remembering the foreground app')
assert.match(files.tauriLib, /async\s+fn\s+last_foreground_selection_text\(\)/, 'frontend must be able to read the cached foreground selection')
assert.match(files.tauriLib, /clear_foreground_selection_text\(\)/, 'native runtime must clear stale external selection when capture finds no selected text')
assert.match(files.tauriLib, /read_clipboard_change_count\(&app\)/, 'native selection capture must compare clipboard change count before trusting copied text')
assert.match(files.tauriLib, /before_change_count\.is_some\(\)[\s\S]*after_change_count\.is_some\(\)[\s\S]*before_change_count == after_change_count[\s\S]*return None/, 'unchanged clipboard must not be trusted only when clipboard change count is available')
assert.match(files.tauriLib, /else\s*\{\s*clear_foreground_selection_text\(\)/, 'failed or empty capture must not leave a previous selected-text object visible')
assert.match(files.tauriLib, /last_foreground_selection_text,/, 'Tauri invoke handler must register last_foreground_selection_text')
assert.match(files.tauriLib, /new_keyboard_event[\s\S]{0,500}KEY_C[\s\S]{0,500}CGEventFlagCommand/, 'macOS capture must use Cmd+C against the foreground selection')
assert.match(files.contextBroker, /externalSelectionContextProvider/, 'Context Broker must expose external selection as a context provider')
assert.match(files.contextBroker, /last_foreground_selection_text/, 'Context Broker must read cached selection through the Tauri command')
assert.match(files.contextBroker, /FOREGROUND_SELECTION_READ_RETRY_MS/, 'Context Broker must tolerate native async selection capture latency')
assert.match(files.contextBroker, /for \(let attempt = 0; attempt < FOREGROUND_SELECTION_READ_ATTEMPTS; attempt \+= 1\)/, 'Context Broker must retry the native selection cache briefly before falling back')
assert.match(files.contextBroker, /externalSelection\?:/, 'WorkContextSnapshot must model external selection separately from editor selection')
assert.match(files.contextBroker, /externalSelectionContextProvider[\s\S]*clipboardContextProvider/, 'default context snapshot must collect external selection before generic clipboard fallback')
assert.match(files.defaultWorkflowProviders, /snapshot\.externalSelection\?\.text/, 'workflow context objects must prefer external selected text as a text object')
assert.match(files.defaultWorkflowProviders, /source:\s*['"]context\.external-selection['"]/, 'external selected text object must have a stable source')

console.log('external selection context checks passed')
