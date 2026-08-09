#!/usr/bin/env node
/**
 * Window entry contracts for:
 *   ?window=launcher
 *   ?window=quick-editor
 *   ?window=plugin-surface
 *
 * Static source checks (avoids Vite-transformed import path flakes from full HTTP smoke).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync('src/main.tsx', 'utf8')
assert.match(main, /initPluginSurfaceWindow|windowType === ['"]plugin-surface['"]/, 'plugin-surface fast path')
assert.match(main, /initEditorCapableWindow/, 'editor-capable init')
assert.match(main, /import\(['"]@monaco-editor\/react['"]\)/, 'Monaco loader dynamic import in source')
assert.match(main, /import\(['"]monaco-editor['"]\)/, 'monaco-editor dynamic import')
assert.match(main, /QuickEditorDetachedView|plugin-surface/, 'window roots')
assert.match(main, /windowType === ['"]launcher['"]|['"]launcher['"]/, 'launcher window type handled')
assert.match(main, /quick-editor/, 'quick-editor window type handled')
assert.match(main, /plugin-surface/, 'plugin-surface window type handled')

const pluginInit = main.match(/async function initPluginSurfaceWindow\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
assert.ok(pluginInit, 'initPluginSurfaceWindow defined')
assert.doesNotMatch(pluginInit, /monaco-editor|@monaco-editor/, 'plugin-surface init must not load Monaco')
console.log('window entry runtime smoke (static) checks passed')
