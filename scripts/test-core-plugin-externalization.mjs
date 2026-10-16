#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const builtinIndex = JSON.parse(readFileSync('src/builtin-plugins/index.json', 'utf8'))
const regexManifest = JSON.parse(readFileSync('src/plugins/regex-tester/manifest.json', 'utf8'))
const regexEntry = builtinIndex.packages.find((entry) => entry.pluginId === 'regex-tester')

assert.equal(builtinIndex.packages.some((entry) => entry.pluginId === 'core-pane'), false, 'core-pane should no longer ship as a builtin plugin')
assert.ok(regexManifest.version, 'regex tester plugin should declare a version')
assert.equal(regexEntry?.version, regexManifest.version, 'builtin index should publish the current regex tester version')

console.log('core plugin externalization checks passed')
