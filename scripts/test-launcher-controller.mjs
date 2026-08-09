#!/usr/bin/env node
/** Launcher controller static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const controller = readFileSync('src/workspace/launcher/controller.ts', 'utf8')
assert.match(controller, /createLauncherController|LauncherController/, 'controller factory')
assert.match(controller, /query|activate|execute|rank|items/i, 'core controller ops')
console.log('launcher controller (static) checks passed')
