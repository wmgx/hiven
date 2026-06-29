#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const contextBroker = read('src/launcher/context/contextBroker.ts')
const editorContextSnapshot = read('src/workspace/editorContextSnapshot.ts')
const editorBridge = read('src/workspace/editorBridge.ts')
const tauriLib = read('src-tauri/src/lib.rs')
const workflowAdapter = read('src/workflow/workflowLauncherAdapter.ts')
const defaultWorkflowProviders = read('src/workflow/defaultWorkflowProviders.ts')

assert.match(contextBroker, /export type WorkContextSnapshot/, 'Context broker must define WorkContextSnapshot')
assert.match(contextBroker, /foreground\?:\s*\{[\s\S]*appName\?:\s*string[\s\S]*processId\?:\s*number[\s\S]*windowTitle\?:\s*string/, 'snapshot must include foreground app fields')
assert.match(contextBroker, /export const foregroundContextProvider/, 'default context broker must expose a foreground provider')
assert.match(contextBroker, /current_foreground_app_context/, 'foreground provider must call the native foreground context command')
assert.match(contextBroker, /\[foregroundContextProvider,\s*editorContextProvider,[\s\S]*clipboardContextProvider/, 'default snapshot must compose foreground, editor, optional external-selection, and clipboard providers')
assert.doesNotMatch(contextBroker, /useWorkspaceStore|runtimeRegistry/, 'global context broker must not directly read editor window store/runtime')
assert.match(contextBroker, /readLocalEditorContextSnapshot/, 'editor-window runtime should delegate local reads to the editor snapshot module')
assert.match(editorContextSnapshot, /if \(!isEditorWindowRuntime\(\)\) return undefined[\s\S]*runtimeRegistry\.getCodeEditor\(state\.activePaneId\)/, 'editor snapshot module must guard local editor runtime reads')
assert.match(editorContextSnapshot, /getValueInRange\(selection\)/, 'editor snapshot module must read selected text from live selection')
assert.match(editorContextSnapshot, /selectionRange:\s*TextRange/, 'editor snapshot module must expose selection range')
assert.match(contextBroker, /activeText:\s*string/, 'editor context snapshot must require active pane text for cross-window launcher APIs')
assert.match(editorContextSnapshot, /activeText:\s*pane\.text/, 'local editor context snapshot must publish active pane text')
assert.match(contextBroker, /EDITOR_WINDOW_LABEL/, 'context broker must use the centralized editor window label')
assert.match(contextBroker, /import \{ EDITOR_WINDOW_LABEL \} from ['"]\.\.\/\.\.\/workspace\/windowManager\/windowLabels['"]/, 'context broker must import the centralized editor label at runtime')
assert.match(contextBroker, /getActiveEditorContextSnapshot/, 'non-editor windows must read synced editor context first')
assert.match(contextBroker, /getEditorContext\(\{ timeoutMs:/, 'non-editor windows must request live editor context through the bridge')
assert.match(editorBridge, /emitTo\(EDITOR_WINDOW_LABEL,/, 'editor bridge must address editor windows through the centralized label')
assert.match(editorBridge, /registerActiveEditorContext/, 'editor bridge must publish active context updates')
assert.match(editorBridge, /typeof snapshot\.activeText === ['"]string['"]/, 'editor bridge must validate activeText before accepting synced editor context')
assert.match(editorBridge, /updateActivePaneSnapshot/, 'editor bridge must publish active pane snapshot updates')
assert.match(contextBroker, /readClipboardText/, 'clipboard provider must read clipboard text')
assert.match(tauriLib, /struct ForegroundAppContext/, 'native runtime must serialize foreground context')
assert.match(tauriLib, /async fn current_foreground_app_context/, 'native runtime must expose current_foreground_app_context')
assert.match(tauriLib, /current_foreground_application_name\(\)/, 'foreground context must include app name when available')
assert.match(tauriLib, /current_foreground_process_id\(\)/, 'foreground context must include process id when available')
assert.match(tauriLib, /current_foreground_app_context,/, 'foreground context command must be registered with Tauri')
assert.match(workflowAdapter, /createDefaultWorkContextSnapshot\(['"]global-hotkey['"]\)/, 'workflow launcher adapter must build a context snapshot before expanding actions')
assert.match(defaultWorkflowProviders, /currentContextObjectProvider[\s\S]*createDefaultWorkContextSnapshot\(['"]global-hotkey['"]\)/, 'current context object provider must use the default context snapshot')

console.log('context snapshot editor checks passed')
