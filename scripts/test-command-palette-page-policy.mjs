#!/usr/bin/env node
/**
 * Command palette is not a main-window page policy anymore.
 * Launcher-only: GlobalLauncher + Quick Editor host surfaces.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

assert.equal(existsSync(join(root, 'src/components/EditorWindow.tsx')), false)
assert.equal(existsSync(join(root, 'src/views/EditorView.tsx')), false)
assert.equal(existsSync(join(root, 'src/components/CommandPalette.tsx')), false)

const app = read('src/App.tsx')
const store = read('src/store.ts')
const host = read('src/launcher/hosts/GlobalLauncherHost.tsx')

assert.match(app, /GlobalLauncher|LauncherRuntimeApp/, 'App is launcher runtime')
assert.doesNotMatch(store, /commandPaletteOpen|setCommandPaletteOpen/, 'store must not expose retired command palette open state')
assert.match(store, /editorCommandBarOpen|globalLauncherOpen|launcherHostSurfaceTarget/, 'store models launcher / host surfaces')
assert.match(host, /useLauncherSession|GlobalLauncher/, 'global launcher host owns session')

console.log('command palette page policy (retired) checks passed')
