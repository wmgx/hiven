#!/usr/bin/env node
/**
 * Global launcher quick-text / collect-input contracts (current UI).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')

assert.equal(existsSync('src/components/CommandPalette.tsx'), false, 'CommandPalette component retired')

const globalLauncher = read('src/components/GlobalLauncher.tsx')
const globalLauncherHost = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const globalLauncherFrames = read('src/components/launcher/GlobalLauncherFrames.tsx')
const collectInput = read('src/components/launcher/GlobalLauncherCollectInputFrame.tsx')
const keyboard = read('src/components/launcher/GlobalLauncherKeyboard.ts')
const session = read('src/workspace/launcher/useLauncherSession.ts')
const app = read('src/App.tsx')

assert.match(globalLauncher, /GlobalLauncherHost/, 'GlobalLauncher wraps host')
assert.match(globalLauncherHost, /useLauncherSession|CollectInput|controller/, 'host owns session/controller')
assert.match(globalLauncherFrames, /GlobalLauncherCollectInputFrame|collect-input|CollectInput/, 'frames include collect-input')
assert.match(collectInput, /preview|CollectInput|footer|Enter|copy|onKeyDown/i, 'collect-input frame handles preview + keys')
assert.match(keyboard, /handleGlobalLauncherKeyDown|isImeComposing|Enter|Escape/, 'keyboard path handles IME + enter/esc')
assert.match(session, /collectDynamicItems|rankLauncherItems|LauncherController/, 'session ranks and controls')
assert.match(app, /GlobalLauncher|LauncherRuntimeApp/, 'App mounts launcher runtime')

console.log('global launcher quick-text checks passed')
