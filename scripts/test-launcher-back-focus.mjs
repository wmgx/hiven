#!/usr/bin/env node
/**
 * Verifies launcher back navigation returns focus to the searchable input so
 * keyboard typing still works after popping controller frames.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const commandPalette = readFileSync('src/components/CommandPalette.tsx', 'utf8')
const globalLauncher = readFileSync('src/components/GlobalLauncher.tsx', 'utf8')

assert.match(
  commandPalette,
  /function focusSearchInputAfterBack\(\)[\s\S]{0,180}requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/,
  'CommandPalette should centralize focus restoration after launcher back navigation',
)

const commandPaletteBackHandlers = commandPalette.match(/controllerRef\.current\?\.back\(\)[\s\S]{0,120}focusSearchInputAfterBack\(\)/g) ?? []
assert.ok(
  commandPaletteBackHandlers.length >= 3,
  'CommandPalette collect-input, param-input, and result back handlers should restore search input focus',
)

const globalLauncherBackHandlers = globalLauncher.match(/controllerRef\.current\?\.back\(\)[\s\S]{0,120}focusSearchInputAfterBack\(\)/g) ?? []
assert.ok(
  globalLauncherBackHandlers.length >= 3,
  'GlobalLauncher controller back handlers should restore search input focus through a shared helper',
)

console.log('launcher back focus checks passed')
