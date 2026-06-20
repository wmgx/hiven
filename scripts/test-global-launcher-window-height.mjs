#!/usr/bin/env node

/**
 * Global launcher standalone window height contract.
 *
 * The native launcher window should never be allowed to remain at a tiny
 * compact height. Even if the frontend resize is delayed or skipped, the
 * fallback height must show the search header, several result rows, and footer.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  indexCss: read('src/index.css'),
  tauriLib: read('src-tauri/src/lib.rs'),
}

function readNumberConstant(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`const\\s+${escaped}(?::\\s*[^=]+)?\\s*=\\s*([0-9.]+)`))
  assert.ok(match, `${name} constant should exist`)
  const value = Number(match[1])
  assert.ok(Number.isFinite(value), `${name} should be numeric`)
  return value
}

function readCssBlock(pattern, label) {
  const match = files.indexCss.match(pattern)
  assert.ok(match, `${label} CSS block should exist`)
  return match[1]
}

function readCssPx(block, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`${escaped}\\s*:\\s*([0-9.]+)px`))
  assert.ok(match, `${property} should be declared in px`)
  const value = Number(match[1])
  assert.ok(Number.isFinite(value), `${property} should be numeric`)
  return value
}

function readCssVerticalPadding(block) {
  const match = block.match(/padding\s*:\s*([0-9.]+)px(?:\s+[0-9.]+px)?/)
  assert.ok(match, 'vertical padding should be declared in px')
  const value = Number(match[1])
  assert.ok(Number.isFinite(value), 'vertical padding should be numeric')
  return value * 2
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:global-launcher-window-height'],
  'node scripts/test-global-launcher-window-height.mjs',
  'package.json must expose test:global-launcher-window-height',
)

const headerBlock = readCssBlock(
  /\.global-launcher-header\.l-search,\s*\.l-search\s*\{([\s\S]*?)\n\}/,
  'launcher search header',
)
const listBlock = readCssBlock(
  /\.global-launcher-body\.l-list,\s*\.l-list\s*\{([\s\S]*?)\n\}/,
  'launcher list body',
)
const rowBlock = readCssBlock(/\.l-row\s*\{([\s\S]*?)\n\}/, 'launcher row')
const selectedRowBlock = readCssBlock(
  /\.l-row\.sel,\s*\.l-row\.selected\s*\{([\s\S]*?)\n\}/,
  'selected launcher row',
)
const footerBlock = readCssBlock(
  /\.global-launcher-footer\.l-foot,\s*\.l-foot\s*\{([\s\S]*?)\n\}/,
  'launcher footer',
)

const headerMinHeight = readCssPx(headerBlock, 'min-height')
const rowHeight = readCssPx(rowBlock, 'height')
const selectedRowHeight = readCssPx(selectedRowBlock, 'height')
const footerVisibleHeight = readCssVerticalPadding(footerBlock) + readCssPx(footerBlock, 'font-size')
const nativeMargin = readNumberConstant(files.globalLauncher, 'STANDALONE_LAUNCHER_VERTICAL_PADDING')
const minRowsBeyondSelected = 3
const minimumUsableLauncherHeight = Math.ceil(
  headerMinHeight +
  readCssVerticalPadding(listBlock) +
  selectedRowHeight +
  rowHeight * minRowsBeyondSelected +
  footerVisibleHeight +
  nativeMargin,
)

const frontendMinHeight = readNumberConstant(files.globalLauncher, 'STANDALONE_LAUNCHER_MIN_HEIGHT')
const nativeCompactHeight = readNumberConstant(files.tauriLib, 'LAUNCHER_COMPACT_HEIGHT')
const failures = []

if (frontendMinHeight < minimumUsableLauncherHeight) {
  failures.push(
    `STANDALONE_LAUNCHER_MIN_HEIGHT should be at least ${minimumUsableLauncherHeight}px so a failed resize cannot leave only the header, one selected row, three more rows, and footer visible; got ${frontendMinHeight}px`,
  )
}

if (nativeCompactHeight < minimumUsableLauncherHeight) {
  failures.push(
    `LAUNCHER_COMPACT_HEIGHT should be at least ${minimumUsableLauncherHeight}px so the first native show frame is usable before frontend resize; got ${nativeCompactHeight}px`,
  )
}

if (failures.length > 0) {
  console.error(`global launcher window height checks failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('global launcher window height checks passed')
