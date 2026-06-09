#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
}

const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

const editorOnlyCommandPaletteOpenGuard =
  /(?:activeView|state\.activeView|useAppStore\.getState\(\)\.activeView)\s*={2,3}\s*['"]editor['"][\s\S]{0,260}setCommandPaletteOpen\(true\)|(?:activeView|state\.activeView|useAppStore\.getState\(\)\.activeView)\s*!={1,2}\s*['"]editor['"][\s\S]{0,120}return[\s\S]{0,260}setCommandPaletteOpen\(true\)|setCommandPaletteOpen\(true\)[\s\S]{0,260}(?:activeView|state\.activeView|useAppStore\.getState\(\)\.activeView)\s*={2,3}\s*['"]editor['"]/

const editorOnlyCommandPaletteRender =
  /activeView\s*={2,3}\s*['"]editor['"][\s\S]{0,220}<CommandPalette\s*\/>|<CommandPalette\s*\/>[\s\S]{0,220}activeView\s*={2,3}\s*['"]editor['"]/

check('ViewId includes the plugin editor and pinned runner pages under test', () => {
  assertHas(
    files.store,
    /export\s+type\s+ViewId\s*=[^\n]*['"]plugin-editor['"][^\n]*['"]pinned-runner['"]/,
    'ViewId should include plugin-editor and pinned-runner so this policy test covers both non-editor pages',
  )
})

check('plugin-editor page cannot open command palette with Cmd/Ctrl+K', () => {
  assert.ok(
    editorOnlyCommandPaletteOpenGuard.test(files.app),
    'plugin-editor can still open command palette: Cmd/Ctrl+K calls setCommandPaletteOpen(true) without an activeView === "editor" guard',
  )
})

check('pinned-runner page cannot open command palette with Cmd/Ctrl+K', () => {
  assert.ok(
    editorOnlyCommandPaletteOpenGuard.test(files.app),
    'pinned-runner can still open command palette: Cmd/Ctrl+K calls setCommandPaletteOpen(true) without an activeView === "editor" guard',
  )
})

check('CommandPalette is only rendered while the editor page is active', () => {
  assert.ok(
    editorOnlyCommandPaletteRender.test(files.app),
    'CommandPalette is rendered outside an activeView === "editor" condition, so a non-editor page can still display it when commandPaletteOpen becomes true',
  )
})

if (failures.length > 0) {
  console.error(`command palette page policy checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('command palette page policy checks passed')
