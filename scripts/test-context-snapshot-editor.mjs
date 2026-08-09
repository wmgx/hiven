#!/usr/bin/env node
/**
 * Context snapshot contracts via contextBroker + editorBridge.
 * editorContextSnapshot.ts was retired; do not reintroduce a parallel module.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

assert.equal(
  existsSync(join(root, 'src/workspace/editorContextSnapshot.ts')),
  false,
  'editorContextSnapshot.ts must remain deleted (use editorBridge)',
)

const contextBroker = read('src/launcher/context/contextBroker.ts')
const editorBridge = read('src/workspace/editorBridge.ts')
const tauriLib = read('src-tauri/src/lib.rs')
const workflowAdapter = read('src/workflow/workflowLauncherAdapter.ts')
const defaultWorkflowProviders = read('src/workflow/defaultWorkflowProviders.ts')

assert.match(contextBroker, /export type WorkContextSnapshot/, 'Context broker must define WorkContextSnapshot')
assert.match(contextBroker, /foreground\?:\s*\{/, 'snapshot must include foreground fields')
assert.match(contextBroker, /export const foregroundContextProvider/, 'default context broker must expose a foreground provider')
assert.match(contextBroker, /current_foreground_app_context/, 'foreground provider must call native foreground context command')
assert.match(editorBridge, /getActiveEditorContextSnapshot|EditorContextSnapshot/, 'editor bridge owns active editor context snapshot')
assert.match(tauriLib, /current_foreground_app_context|remember_previous_foreground_app/, 'native foreground helpers exist')
assert.match(workflowAdapter, /WorkObject|WorkAction|LauncherItem/, 'workflow adapter present')
assert.match(defaultWorkflowProviders, /register|provider|WorkObject/, 'default workflow providers present')

console.log('context snapshot editor (via broker + bridge) checks passed')
