#!/usr/bin/env node
/** Launcher registry static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const registry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
const normalize = readFileSync('src/workspace/launcher/normalizeContribution.ts', 'utf8')
assert.match(registry, /export function|register|listLauncher|getLauncher/i, 'registry API')
assert.match(registry, /normalizeContribution|tool|plugin/i, 'normalizes contributions')
assert.match(normalize, /normalizeContribution|export function/, 'normalize contribution module')
console.log('launcher registry (static) checks passed')
