#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const editorItems = read('src/workspace/launcher/editorWindowItems.ts')
const hostProvider = read('src/workspace/launcher/hostProvider.ts')
const editorWindowApi = read('src/workspace/editorWindow.ts')
const editorBridge = read('src/workspace/editorBridge.ts')
const outputRouter = read('src/workflow/outputRouter.ts')
const defaultWorkflowProviders = read('src/workflow/defaultWorkflowProviders.ts')

assert.match(hostProvider, /getEditorWindowItems\(\)/, 'host provider must register editor window launcher items')
assert.match(editorItems, /systemKey:\s*['"]host:window:editor['"]/, 'global launcher must expose a stable Open Editor item')
assert.match(editorItems, /surfaces:\s*\[['"]global-launcher['"]\]/, 'Open Editor must appear in global launcher')
assert.match(editorItems, /requiredCapabilities:\s*\[['"]host-surfaces['"]\]/, 'Open Editor must require host-surface capability')
assert.match(editorItems, /requestOpenEditorWindow\(\)/, 'Open Editor item must call the editor window manager')
assert.match(editorWindowApi, /upsertSurfaceInstance\([\s\S]*id:\s*['"]editor['"]/, 'opening editor must update the surface registry')
assert.match(editorBridge, /createEditorPane/, 'editor bridge must expose pane creation for open-in-editor requests')
assert.match(outputRouter, /openInEditor:[\s\S]*createEditorPane\(\{[\s\S]*text,[\s\S]*title:[\s\S]*language:/, 'output router must support opening text into editor through the editor bridge')
assert.match(defaultWorkflowProviders, /workflow\.open-in-editor[\s\S]*kind:\s*['"]open-in-editor['"]/, 'workflow text actions must expose Open in Editor')

console.log('global launcher open editor checks passed')
