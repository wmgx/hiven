#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const globalLauncher = read('src/components/GlobalLauncher.tsx')
const lineToolsPlugin = read('src/plugins/lineTools/index.ts')
const packageJson = read('package.json')

assert.match(packageJson, /test:global-launcher-quick-text/, 'package.json should expose the quick text verifier')
assert.match(lineToolsPlugin, /tools:\s*\[/, 'quick text style tools should be contributed through the tool-first launcher API')
assert.match(lineToolsPlugin, /id:\s*['"]reverse['"][\s\S]{0,420}surfaces:\s*\{[\s\S]{0,120}launcher:\s*true/, 'reverse should be available as a launcher tool')
assert.match(lineToolsPlugin, /inputPolicy:\s*\{\s*mode:\s*['"]auto['"]\s*\}/, 'reverse should use the shared auto input policy')
assert.match(globalLauncher, /collectStaticCandidates\(['"]global-launcher['"]\)/, 'GlobalLauncher should source quick text style tools from the launcher registry')
assert.match(globalLauncher, /controllerRef\.current\?\.submitInput\(\)|controllerRef\.current\.selectItem\(domainItem\)/, 'GlobalLauncher should execute tool output through LauncherController')
assert.match(globalLauncher, /controllerState[\s\S]{0,240}kind\s*===\s*['"]result['"]/, 'GlobalLauncher should render controller output result frames')
assert.doesNotMatch(globalLauncher, /quickTextSession/, 'GlobalLauncher should not keep a parallel quick text session')
assert.doesNotMatch(globalLauncher, /runQuickTextCommand|isQuickTextCommand/, 'GlobalLauncher should not use the legacy quick text command runner')
assert.doesNotMatch(globalLauncher, /pluginRegistry\.getAllCommands\(\)/, 'GlobalLauncher should not auto-discover commands for quick text')
assert.doesNotMatch(globalLauncher, /global-launcher-quick-preview/, 'legacy quick preview UI should be removed in favor of controller result frames')

console.log('global launcher quick text checks passed')
