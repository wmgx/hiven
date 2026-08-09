#!/usr/bin/env node
/**
 * Global launcher list / result row UI contracts (post-v3 mixed list).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

assert.equal(existsSync(join(root, 'src/components/CommandPalette.tsx')), false)

const mixedList = read('src/components/launcher/LauncherMixedList.tsx')
const resultRow = read('src/components/launcher/LauncherResultChoiceRow.tsx')
const collectInput = read('src/components/launcher/GlobalLauncherCollectInputFrame.tsx')
const searchFrame = read('src/components/launcher/GlobalLauncherSearchFrame.tsx')
const css = read('src/index.css')

assert.match(mixedList, /LauncherMixedList|l-row|selected/, 'mixed list renders selectable rows')
assert.match(resultRow, /LauncherResultChoiceRow|primaryAction|secondary/, 'result choice rows exist')
assert.match(collectInput, /preview|choices|CollectInput/i, 'collect-input can show preview/choices')
assert.match(searchFrame, /search|query|input|GlobalLauncherSearchFrame/i, 'search frame present')
assert.match(css, /--launcher-list-max-height|l-row|\.global-launcher/, 'launcher CSS tokens/classes present')

console.log('global launcher v3 UI checks passed')
