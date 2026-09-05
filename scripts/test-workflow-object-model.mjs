#!/usr/bin/env node
/**
 * Workflow object / action / output model contracts.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

assert.equal(existsSync(join(root, 'src/workspace/editorContextSnapshot.ts')), false)

const files = {
  packageJson: read('package.json'),
  workObject: read('src/workflow/workObject.ts'),
  workAction: read('src/workflow/workAction.ts'),
  outputTarget: read('src/workflow/outputTarget.ts'),
  outputRouter: read('src/workflow/outputRouter.ts'),
  workflowRegistry: read('src/workflow/workflowRegistry.ts'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  workflowLauncherAdapter: read('src/workflow/workflowLauncherAdapter.ts'),
  workflowIndex: read('src/workflow/index.ts'),
  contextBroker: read('src/launcher/context/contextBroker.ts'),
  surfaceActions: read('src/surfaces/actions.ts'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
}

assert.match(files.workObject, /export type WorkObject|type WorkObject/, 'WorkObject type exists')
assert.match(files.workAction, /export type WorkAction|type WorkAction/, 'WorkAction type exists')
assert.match(files.outputTarget, /OutputTarget|output/, 'output target model exists')
assert.match(files.outputRouter, /routeTextOutput|copy|paste/, 'output router routes text')
assert.match(files.workflowRegistry, /register|getWorkActions|WorkAction/, 'workflow registry exists')
assert.match(files.defaultWorkflowProviders, /provider|register|WorkObject/, 'default providers exist')
assert.doesNotMatch(files.defaultWorkflowProviders, /surfaceObjectProvider/, 'surface registry entries stay out of launcher search')
assert.match(files.workflowLauncherAdapter, /LauncherItem|WorkAction|adapter/, 'launcher adapter exists')
assert.match(files.contextBroker, /WorkContextSnapshot/, 'context broker snapshot exists')
assert.match(files.surfaceActions, /focusSurfaceInstance|showQuickEditorSurface|requestOpenLauncherHostSurface/, 'surface focus uses launcher-only paths')
assert.doesNotMatch(files.surfaceActions, /showEditorWindow/, 'surface focus must not call retired showEditorWindow')
assert.match(files.hostProvider, /getHostLauncherItems|dynamic|desktop/, 'host provider contributes launcher items')

console.log('workflow object model checks passed')
