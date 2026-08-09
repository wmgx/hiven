#!/usr/bin/env node
/** Editor command bar scope — QuickEditorCommandOverlay (EditorCommandBarHost retired). */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')
assert.equal(existsSync('src/launcher/hosts/EditorCommandBarHost.tsx'), false, 'EditorCommandBarHost must stay deleted')

const overlay = read('src/components/quickEditor/QuickEditorCommandOverlay.tsx')
const types = read('src/workspace/launcher/types.ts')
const hostEditorActions = read('src/workspace/launcher/hostEditorActions.ts')
const hostActions = read('src/workspace/launcher/hostActions.ts')
const registry = read('src/workspace/launcher/registry.ts')

assert.match(overlay, /filterEditorCommandBarItems/, 'quick editor overlay filters editor-command-bar items')
assert.match(overlay, /useLauncherSession|hostId/, 'overlay owns launcher session')
assert.match(types, /filterEditorCommandBarItems|isEditorCommandBarItem/, 'filter lives in launcher types')
assert.match(types, /'editor-command-bar'/, 'editor-command-bar host id retained')
assert.match(types, /quick-editor-command/, 'quick-editor-command host id present')
assert.match(hostEditorActions, /getHostEditorActionItems|surfaces:\s*\[['"]editor-command-bar['"]/, 'editor-local actions scoped')
assert.match(hostActions, /getHostEditorActionItems/, 'hostActions aggregates editor actions')
assert.match(registry, /launcherHostHasCapability|requiredCapabilities/, 'registry enforces host capabilities')
assert.doesNotMatch(hostActions, /host:global:search-all-hiven/, 'no Search-all bridge in host actions')
console.log('editor command bar scope (quick-editor overlay) checks passed')
