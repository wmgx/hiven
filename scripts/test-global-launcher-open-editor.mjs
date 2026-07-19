#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const hostProvider = read('src/workspace/launcher/hostProvider.ts')
const editorWindowApi = read('src/workspace/editorWindow.ts')
const editorBridge = read('src/workspace/editorBridge.ts')
const outputRouter = read('src/workflow/outputRouter.ts')
const defaultWorkflowProviders = read('src/workflow/defaultWorkflowProviders.ts')

assert.match(hostProvider, /registerHostLauncherProviders/, 'host provider must expose registerHostLauncherProviders')
assert.match(hostProvider, /setHostLauncherItemsProvider/, 'host provider must register static launcher items')
assert.match(hostProvider, /setHostLauncherDynamicItemsProvider/, 'host provider must register dynamic launcher items')
assert.match(editorWindowApi, /upsertSurfaceInstance\(/, 'opening editor must update the surface registry')
assert.match(editorWindowApi, /showQuickEditorWindow/, 'editor window API must call the quick editor window manager')
assert.match(editorBridge, /createEditorPane/, 'editor bridge must expose pane creation for open-in-editor requests')
assert.match(editorBridge, /showEditorWindow/, 'editor bridge must import showEditorWindow for fire-and-forget requests')
assert.match(editorBridge, /openEditorDiffPage/, 'editor bridge must support opening a diff page in the editor')
assert.match(outputRouter, /openInEditor[\s\S]*createQuickEditorPane/, 'output router must support opening text into editor through quick editor pane')
assert.match(defaultWorkflowProviders, /workflow\.open-in-editor[\s\S]*kind:\s*['"]open-in-editor['"]/, 'workflow text actions must expose Open in Editor')

console.log('global launcher open editor checks passed')
