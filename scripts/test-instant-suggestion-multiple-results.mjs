#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pluginTypes = readFileSync('src/workspace/pluginTypes.ts', 'utf8')
const commandPalette = readFileSync('src/components/CommandPalette.tsx', 'utf8')
const globalLauncher = readFileSync('src/components/GlobalLauncher.tsx', 'utf8')

assert.match(
  pluginTypes,
  /suggest\(ctx:\s*InstantSuggestionContext\):\s*InstantSuggestion\s*\|\s*InstantSuggestion\[\]\s*\|\s*null/,
  'InstantSuggestionProvider should allow returning multiple suggestions',
)
assert.match(
  commandPalette,
  /normalizeInstantSuggestions[\s\S]*Array\.isArray\(suggestion\)[\s\S]*computeInstantSuggestions/,
  'CommandPalette should normalize provider results into multiple instant suggestions',
)
assert.match(
  commandPalette,
  /return\s+\[\.\.\.instantSuggestions,\s*\.\.\.sorted\]/,
  'CommandPalette should prepend all instant suggestions before command results',
)
assert.match(
  globalLauncher,
  /normalizeInstantSuggestions[\s\S]*Array\.isArray\(suggestion\)/,
  'GlobalLauncher should normalize provider results into multiple instant suggestions',
)
assert.match(
  globalLauncher,
  /return\s+\[\.\.\.instantItems,\s*\.\.\.base\]/,
  'GlobalLauncher should prepend all instant suggestions before base results',
)

console.log('instant suggestion multiple result checks passed')
