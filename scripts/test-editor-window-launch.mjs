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

function blockAround(source, marker, nextMarker = /\n\s*\},\n\s*\{/g) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  nextMarker.lastIndex = start + marker.length
  const next = nextMarker.exec(source)
  return source.slice(start, next ? next.index : source.length)
}

function firstExisting(paths) {
  for (const path of paths) {
    const source = readOptional(path)
    if (source) return { path, source }
  }
  return null
}

const files = {
  packageJson: read('package.json'),
  rustLib: read('src-tauri/src/lib.rs'),
  app: readOptional('src/App.tsx') ?? '',
  main: readOptional('src/main.tsx') ?? '',
  hostActions: readOptional('src/workspace/launcher/hostActions.ts') ?? '',
  globalLauncher: readOptional('src/components/GlobalLauncher.tsx') ?? '',
  pluginApi: readOptional('src/workspace/launcher/pluginApi.ts') ?? '',
  effectRunner: readOptional('src/workspace/effectRunner.ts') ?? '',
}

const packageJson = JSON.parse(files.packageJson)
const routingSources = [files.app, files.main].join('\n')
const launcherSources = [files.hostActions, files.globalLauncher, files.pluginApi, files.effectRunner].join('\n')
const editorWindowManager = firstExisting([
  'src/workspace/windowManager/editorWindow.ts',
  'src/workspace/windowManager/editorWindows.ts',
  'src/workspace/editorWindow.ts',
  'src/workspace/editorWindows.ts',
])
const editorWindowApp = readOptional('src/windows/EditorWindowApp.tsx')

check('package script', () => {
  assert.equal(
    packageJson.scripts?.['test:editor-window-launch'],
    'node scripts/test-editor-window-launch.mjs',
    'package.json must expose test:editor-window-launch',
  )
})

check('Rust editor window commands are implemented and registered', () => {
  assert.match(
    files.rustLib,
    /#\s*\[\s*tauri::command\s*\]\s*(?:async\s+)?fn\s+show_editor_window\s*\(/,
    'src-tauri/src/lib.rs must implement a #[tauri::command] show_editor_window function',
  )
  assert.match(
    files.rustLib,
    /#\s*\[\s*tauri::command\s*\]\s*(?:async\s+)?fn\s+close_editor_window\s*\(/,
    'src-tauri/src/lib.rs must implement a #[tauri::command] close_editor_window function',
  )

  const handlerBlock = files.rustLib.match(/tauri::generate_handler!\s*\[[\s\S]*?\]/)?.[0] ?? ''
  assert.match(handlerBlock, /\bshow_editor_window\b/, 'show_editor_window must be registered in generate_handler')
  assert.match(handlerBlock, /\bclose_editor_window\b/, 'close_editor_window must be registered in generate_handler')

  const showBlock = blockAround(files.rustLib, 'show_editor_window', /\n#\s*\[\s*tauri::command\s*\]|\n(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+/g)
  const closeBlock = blockAround(files.rustLib, 'close_editor_window', /\n#\s*\[\s*tauri::command\s*\]|\n(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+/g)

  assert.match(showBlock, /get_webview_window\s*\(\s*["']editor["']\s*\)/, 'show_editor_window must reuse the singleton editor window label')
  assert.match(showBlock, /index\.html\?window=editor/, 'show_editor_window must create the editor URL with ?window=editor')
  assert.match(showBlock, /WebviewWindowBuilder|from_config/, 'show_editor_window must create a Tauri webview window when missing')
  assert.match(showBlock, /\.show\s*\(\s*\)[\s\S]{0,180}\.set_focus\s*\(\s*\)|\.set_focus\s*\(\s*\)[\s\S]{0,180}\.show\s*\(\s*\)/, 'show_editor_window must show and focus an existing editor window')
  assert.match(closeBlock, /get_webview_window\s*\(\s*["']editor["']\s*\)/, 'close_editor_window must target the singleton editor window label')
  assert.match(closeBlock, /\.(close|destroy)\s*\(\s*\)/, 'close_editor_window must close or destroy the editor window')
})

check('frontend editor window manager API', () => {
  assert.ok(
    editorWindowManager,
    'src/workspace/windowManager/editorWindow.ts or an equivalent editor window manager module must exist',
  )
  assert.match(
    editorWindowManager.source,
    /export\s+(?:async\s+)?function\s+(?:showEditorWindow|openEditorWindow)\s*\(/,
    `${editorWindowManager.path} must export showEditorWindow/openEditorWindow`,
  )
  assert.match(
    editorWindowManager.source,
    /export\s+(?:async\s+)?function\s+closeEditorWindow\s*\(/,
    `${editorWindowManager.path} must export closeEditorWindow`,
  )
  assert.match(
    editorWindowManager.source,
    /invoke\s*\(\s*['"]show_editor_window['"]/,
    `${editorWindowManager.path} must call the show_editor_window Tauri command`,
  )
  assert.match(
    editorWindowManager.source,
    /invoke\s*\(\s*['"]close_editor_window['"]/,
    `${editorWindowManager.path} must call the close_editor_window Tauri command`,
  )
})

check('window=editor routes to EditorWindowApp', () => {
  assert.match(routingSources, /new\s+URLSearchParams\s*\(\s*window\.location\.search\s*\)/, 'App.tsx or main.tsx must read window.location.search')
  assert.match(routingSources, /(?:windowKind|windowType|params\.get\(\s*['"]window['"]\s*\))[\s\S]{0,260}['"]editor['"]/, 'App.tsx or main.tsx must branch on ?window=editor')
  assert.match(routingSources, /EditorWindowApp/, 'App.tsx or main.tsx must render EditorWindowApp for the editor window route')
})

check('EditorWindowApp composes editor surface pieces', () => {
  assert.ok(editorWindowApp, 'src/windows/EditorWindowApp.tsx must exist')
  assert.match(editorWindowApp, /export\s+function\s+EditorWindowApp\s*\(/, 'EditorWindowApp must be exported as a React component')
  assert.match(editorWindowApp, /EditorView/, 'EditorWindowApp must reuse EditorView')
  assert.match(editorWindowApp, /EditorCommandBar|CommandPalette/, 'EditorWindowApp must mount EditorCommandBar/CommandPalette inside the editor window')
})

check('GlobalLauncher host action opens the editor window', () => {
  const editorBlock = blockAround(files.hostActions, "systemKey: 'host:view:editor'")
  const hasOpenEditorAction =
    /Open Editor|打开编辑器|title:\s*['"]Editor['"]/.test(editorBlock)
    && /showEditorWindow|openEditorWindow|show_editor_window/.test(editorBlock)
  const showMainPanelMigrated =
    /showMainPanel\s*\([^)]*\)[\s\S]{0,900}(showEditorWindow|openEditorWindow|show_editor_window)/.test(launcherSources)
  assert.ok(
    hasOpenEditorAction || showMainPanelMigrated,
    'GlobalLauncher/host actions must expose Open Editor or migrate showMainPanel semantics to showEditorWindow',
  )
})

if (failures.length > 0) {
  console.error('editor window launch contract checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('editor window launch contract checks passed')
