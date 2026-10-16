#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))

assert.ok(!tauriConfig.app.windows.some((window) => window.label === 'main'), 'Tauri config must not declare a main startup window')
assert.ok(tauriConfig.app.windows.some((window) => window.label === 'launcher' && window.visible === false), 'startup must keep only a hidden launcher runtime window')
assert.ok(!capability.windows.includes('main'), 'capability scope must not include retired main window')

console.log('no main window startup checks passed')
