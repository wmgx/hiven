#!/usr/bin/env node
/** Host capability routing static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const types = readFileSync('src/workspace/launcher/types.ts', 'utf8')
const registry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
const hostActions = readFileSync('src/workspace/launcher/hostActions.ts', 'utf8')
assert.match(types, /capabilities|LauncherHostId|global-launcher|editor-command-bar/, 'host capability model')
assert.match(registry, /launcherHostHasCapability|requiredCapabilities/, 'capability filter')
assert.match(hostActions, /surfaces:\s*\[/, 'host actions declare surfaces')
console.log('launcher host capability routing (static) checks passed')
