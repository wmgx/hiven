#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(path) {
  return readFileSync(path, 'utf8')
}

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === openChar) depth++
    if (ch === closeChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function extractToolsArray(source) {
  const marker = 'tools:'
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return null
  const openIndex = source.indexOf('[', markerIndex)
  if (openIndex < 0) return null
  const closeIndex = findMatching(source, openIndex, '[', ']')
  if (closeIndex < 0) return null
  return source.slice(openIndex + 1, closeIndex)
}

function splitTopLevelObjects(arraySource) {
  const items = []
  let i = 0
  while (i < arraySource.length) {
    const open = arraySource.indexOf('{', i)
    if (open < 0) break
    const close = findMatching(arraySource, open, '{', '}')
    if (close < 0) break
    items.push(arraySource.slice(open, close + 1))
    i = close + 1
  }
  return items
}

function assertLauncherToolsHaveSubtitles() {
  const pluginsRoot = 'src/plugins'
  for (const dir of readdirSync(pluginsRoot)) {
    const indexPath = join(pluginsRoot, dir, 'index.ts')
    const tsxPath = join(pluginsRoot, dir, 'index.tsx')
    const filePath = existsSync(indexPath) ? indexPath : existsSync(tsxPath) ? tsxPath : null
    if (!filePath) continue
    const toolsSource = extractToolsArray(read(filePath))
    if (!toolsSource) continue
    for (const item of splitTopLevelObjects(toolsSource)) {
      if (!/surfaces\s*:\s*\{[\s\S]*launcher\s*:\s*true/.test(item)) continue
      assert.match(item, /subtitle\s*:/, `${filePath} launcher tool is missing subtitle`)
    }
  }
}

function assertBuiltinVersionsMatchManifests() {
  const index = JSON.parse(read('src/builtin-plugins/index.json'))
  assert.equal(index.version, 11, 'builtin plugin index version should be bumped for launcher migration')
  for (const pkg of index.packages) {
    const manifest = JSON.parse(read(`src/plugins/${pkg.dir}/manifest.json`))
    assert.equal(pkg.version, manifest.version, `${pkg.pluginId} builtin index version should match manifest version`)
  }
}

assertLauncherToolsHaveSubtitles()
assertBuiltinVersionsMatchManifests()

console.log('launcher plugin contract checks passed')
