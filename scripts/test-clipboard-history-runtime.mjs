#!/usr/bin/env node
/** Clipboard history runtime wiring (static). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')
const storageImpl = read('src/workspace/pluginStorage.ts')
assert.match(storageImpl, /createPluginPrivateStorage/, 'private storage factory')
assert.match(storageImpl, /plugin_kv_get|plugin_kv_set/, 'native KV')
assert.match(storageImpl, /plugin_blob_save|plugin_blob_read/, 'native blob')
assert.match(storageImpl, /__HIVEN_WEB_NATIVE_BRIDGE__[\s\S]*URL\.createObjectURL/, 'browser bridge renders native blobs with browser URLs')
const surface = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
assert.match(surface, /setSelectedFullItem\(item\)[\s\S]*setItems/, 'loaded full items hydrate missing list previews')
const paste = read('src/workspace/pluginPaste.ts')
assert.match(paste, /paste|simulate_paste|clipboard/i, 'paste API')
const plugin = read('src/plugins/clipboard-history/index.tsx')
assert.match(plugin, /definePlugin|clipboard-history/, 'plugin entry')
const selection = read('src/components/launcher/useGlobalLauncherSelectionController.ts')
assert.match(selection, /openPluginSurface|showPluginSurfaceWindow/, 'selection opens plugin surfaces')
const hostLifecycle = read('src/components/launcher/GlobalLauncherHostLifecycle.ts')
assert.match(hostLifecycle, /holdStickyRestore|sticky/i, 'sticky restore on open path')
console.log('clipboard history runtime (static) checks passed')
