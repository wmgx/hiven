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

const packageJson = JSON.parse(read('package.json'))
const contextBroker = firstExisting([
  'src/launcher/context/contextBroker.ts',
  'src/workspace/launcher/contextBroker.ts',
  'src/workflow/contextBroker.ts',
])

const launcherRegistrySources = [
  readOptional('src/workspace/launcher/types.ts') ?? '',
  readOptional('src/workspace/launcher/registry.ts') ?? '',
  readOptional('src/workspace/launcher/controller.ts') ?? '',
  readOptional('src/launcher/useLauncherSession.ts') ?? '',
  readOptional('src/components/GlobalLauncher.tsx') ?? '',
  readOptional('src/components/CommandPalette.tsx') ?? '',
].join('\n')

check('package script', () => {
  assert.equal(
    packageJson.scripts?.['test:context-snapshot-editor'],
    'node scripts/test-context-snapshot-editor.mjs',
    'package.json must expose test:context-snapshot-editor',
  )
})

check('Context Broker module exists and exports broker API', () => {
  assert.ok(
    contextBroker,
    'src/launcher/context/contextBroker.ts or equivalent Context Broker module must exist',
  )
  assert.ok(
    sourceHasExport(contextBroker.source, 'ContextBroker') ||
      sourceHasExport(contextBroker.source, 'createContextBroker') ||
      sourceHasExport(contextBroker.source, 'getInvocationContext') ||
      sourceHasExport(contextBroker.source, 'getEditorContextSnapshot'),
    `${contextBroker?.path ?? 'Context Broker'} must export ContextBroker/createContextBroker/getInvocationContext/getEditorContextSnapshot`,
  )
})

check('Context Broker supports global invocation context', () => {
  const source = contextBroker?.source ?? ''
  assert.match(
    source,
    /global[-_ ]?invocation|GlobalInvocation|invocationSource|source:\s*['"`]global-launcher['"`]|surfaceId:\s*['"`]global-launcher['"`]/,
    'Context Broker must model global invocation from the global launcher',
  )
})

check('Context Broker supports editor context snapshot', () => {
  const source = contextBroker?.source ?? ''
  assert.match(
    source,
    /EditorContextSnapshot|getEditorContextSnapshot|editorContextSnapshot/,
    'Context Broker must expose an editor context snapshot',
  )
})

check('editor context snapshot contains editor identity and language fields', () => {
  const source = contextBroker?.source ?? ''
  assert.match(source, /\bactivePaneId\b/, 'editor context snapshot must include activePaneId')
  assert.match(source, /\bpaneIds\b/, 'editor context snapshot must include paneIds')
  assert.match(source, /\blanguage\b/, 'editor context snapshot must include language')
})

check('editor context snapshot contains selection and cursor fields', () => {
  const source = contextBroker?.source ?? ''
  assert.match(source, /\bselectedText\b/, 'editor context snapshot must include selectedText')
  assert.match(source, /\bselectionRange\b/, 'editor context snapshot must include selectionRange')
  assert.match(source, /\bcursor\b|\bcursorPosition\b|\bposition\b/, 'editor context snapshot must include cursor/cursorPosition')
})

check('launcher can recognize object-backed items or WorkObject provider/action registry basics', () => {
  assert.match(
    launcherRegistrySources,
    /WorkObject|object-backed|objectBacked|object:\s*WorkObject|workObject/,
    'Launcher item model/registry must recognize object-backed items or WorkObject references',
  )
  assert.match(
    launcherRegistrySources,
    /WorkObjectProvider|workObjectProvider|setWorkObjectProvider|registerWorkObjectProvider|objectProvider/,
    'Launcher registry must include WorkObject provider registration basics',
  )
  assert.match(
    launcherRegistrySources,
    /WorkAction|workAction|registerWorkAction|setWorkActionRegistry|actionRegistry/,
    'Launcher registry must include WorkAction/action registry basics',
  )
})

if (failures.length > 0) {
  console.error('context snapshot editor contract checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('context snapshot editor contract checks passed')
