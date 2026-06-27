#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const failures = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readOptional(path) {
  const fullPath = join(root, path)
  if (!existsSync(fullPath)) return null
  return read(path)
}

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function firstExisting(paths) {
  for (const path of paths) {
    const source = readOptional(path)
    if (source !== null) return { path, source }
  }
  return null
}

function sourceHasExport(source, name) {
  return new RegExp(`export\\s+(?:type|interface|class|const|function)\\s+${name}\\b`).test(source) ||
    new RegExp(`export\\s*\\{[\\s\\S]*\\b${name}\\b[\\s\\S]*\\}`).test(source)
}

function assertExported(module, name) {
  assert.ok(module, `${name} module or equivalent export must exist`)
  assert.ok(
    sourceHasExport(module.source, name),
    `${module.path} must export ${name}`,
  )
}

function assertLiteral(source, literal, message) {
  assert.match(
    source,
    new RegExp(`['"\`]${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`),
    message,
  )
}

const packageJson = JSON.parse(read('package.json'))
const workflowIndex = readOptional('src/workflow/index.ts')

const modules = {
  workObject: firstExisting([
    'src/workflow/workObject.ts',
    'src/workspace/workObject.ts',
    'src/workspace/launcher/workObject.ts',
  ]) ?? (workflowIndex && sourceHasExport(workflowIndex, 'WorkObject')
    ? { path: 'src/workflow/index.ts', source: workflowIndex }
    : null),
  workAction: firstExisting([
    'src/workflow/workAction.ts',
    'src/workspace/workAction.ts',
    'src/workspace/launcher/workAction.ts',
  ]) ?? (workflowIndex && sourceHasExport(workflowIndex, 'WorkAction')
    ? { path: 'src/workflow/index.ts', source: workflowIndex }
    : null),
  outputTarget: firstExisting([
    'src/workflow/outputTarget.ts',
    'src/workspace/outputTarget.ts',
    'src/workspace/launcher/outputTarget.ts',
  ]) ?? (workflowIndex && sourceHasExport(workflowIndex, 'OutputTarget')
    ? { path: 'src/workflow/index.ts', source: workflowIndex }
    : null),
  outputRouter: firstExisting([
    'src/workflow/outputRouter.ts',
    'src/workspace/outputRouter.ts',
    'src/workspace/launcher/outputRouter.ts',
  ]) ?? (workflowIndex && sourceHasExport(workflowIndex, 'OutputRouter')
    ? { path: 'src/workflow/index.ts', source: workflowIndex }
    : null),
}

check('package script', () => {
  assert.equal(
    packageJson.scripts?.['test:output-router-text-targets'],
    'node scripts/test-output-router-text-targets.mjs',
    'package.json must expose test:output-router-text-targets',
  )
})

check('workflow object/action/target/router modules or equivalent exports exist', () => {
  assertExported(modules.workObject, 'WorkObject')
  assertExported(modules.workAction, 'WorkAction')
  assertExported(modules.outputTarget, 'OutputTarget')
  assertExported(modules.outputRouter, 'OutputRouter')
})

check('OutputTarget covers required text destinations', () => {
  const source = modules.outputTarget?.source ?? ''
  assertLiteral(source, 'copy', 'OutputTarget must support copy')
  assertLiteral(source, 'paste-to-foreground-app', 'OutputTarget must support paste-to-foreground-app')
  assertLiteral(source, 'replace-editor-selection', 'OutputTarget must support replace-editor-selection')
  assert.match(
    source,
    /['"`](?:insert-editor|insert-to-editor|insert-into-editor)['"`]|\binsertEditor\b/,
    'OutputTarget must support inserting text into an editor',
  )
  assert.match(
    source,
    /['"`](?:open-editor|open-editor-window)['"`]|\bopenEditor\b|\bopenEditorWindow\b|\bshowEditorWindow\b/,
    'OutputTarget must support opening an editor target',
  )
  assertLiteral(source, 'open-plugin-surface', 'OutputTarget must support open-plugin-surface')
  assertLiteral(source, 'attach-editor-panel', 'OutputTarget must support attach-editor-panel')
  assertLiteral(source, 'save-to-shelf', 'OutputTarget must support save-to-shelf')
})

check('OutputRouter delegates to existing host capabilities', () => {
  const source = modules.outputRouter?.source ?? ''
  assert.match(
    source,
    /writeText|writeClipboard|copyText|clipboard-manager|navigator\.clipboard/,
    'OutputRouter must call an existing clipboard write capability',
  )
  assert.match(
    source,
    /createPluginPaste|pasteText|simulate_paste|paste-to-foreground-app/,
    'OutputRouter must call the existing foreground paste capability',
  )
  assert.match(
    source,
    /showEditorWindow|openEditorWindow|show_editor_window/,
    'OutputRouter must call the existing editor window open capability',
  )
  assert.match(
    source,
    /openPanelV2|panel\.openV2|openPanel\(/,
    'OutputRouter must call the existing panel open capability',
  )
  assert.match(
    source,
    /pluginSurface|openPluginSurface|PluginSurface|plugin-surface/,
    'OutputRouter must call the existing plugin surface open capability',
  )
})

if (failures.length > 0) {
  console.error('output router text target contract checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('output router text target contract checks passed')
