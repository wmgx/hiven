#!/usr/bin/env node
/**
 * Verifies launcher back navigation returns focus to the searchable input so
 * keyboard typing still works after popping controller frames.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const commandPalette = readFileSync('src/components/CommandPalette.tsx', 'utf8')
const globalLauncher = readFileSync('src/components/GlobalLauncher.tsx', 'utf8')
const editorCommandBarHost = readFileSync('src/launcher/hosts/EditorCommandBarHost.tsx', 'utf8')
const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const globalLauncherHostLifecycle = readFileSync('src/components/launcher/GlobalLauncherHostLifecycle.ts', 'utf8')
const globalLauncherKeyboard = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')

assert.match(commandPalette, /EditorCommandBar/, 'CommandPalette should delegate to EditorCommandBar')
assert.match(
  editorCommandBarHost,
  /function focusSearchInputAfterBack\(\)[\s\S]{0,180}requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/,
  'EditorCommandBarHost should centralize focus restoration after launcher back navigation',
)

const commandPaletteBackHandlers = editorCommandBarHost.match(/controllerRef\.current\?\.back\(\)[\s\S]{0,120}focusSearchInputAfterBack\(\)/g) ?? []
assert.ok(
  commandPaletteBackHandlers.length >= 3,
  'CommandPalette collect-input, param-input, and result back handlers should restore search input focus',
)

assert.match(globalLauncher, /GlobalLauncherHost/, 'GlobalLauncher should delegate to GlobalLauncherHost')
assert.match(
  globalLauncherHostLifecycle,
  /focusSearchInputAfterBack\s*=\s*useCallback\(\(\) => \{[\s\S]{0,180}requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/,
  'GlobalLauncher lifecycle helper should centralize focus restoration after launcher back navigation',
)
const globalLauncherBackHandlers = (globalLauncherHost + '\n' + globalLauncherHostLifecycle + '\n' + globalLauncherKeyboard).match(/controllerRef\.current\?\.back(?:\?\.)?\(\)/g) ?? []
const globalLauncherFocusHandlers = (globalLauncherHost + '\n' + globalLauncherHostLifecycle + '\n' + globalLauncherKeyboard).match(/focusSearchInputAfterBack\(\)/g) ?? []
assert.ok(
  globalLauncherBackHandlers.length >= 3 && globalLauncherFocusHandlers.length >= 3,
  'GlobalLauncher controller back handlers should restore search input focus through a shared helper',
)

console.log('launcher back focus checks passed')
