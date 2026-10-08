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
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  globalLauncherGeometry: read('src/components/launcher/GlobalLauncherGeometry.ts'),
  globalLauncherLayout: read('src/components/launcher/GlobalLauncherLayout.ts'),
  globalLauncherWindowLifecycle: read('src/components/launcher/GlobalLauncherWindowLifecycle.ts'),
  launcherWindow: read('src/workspace/windowManager/launcherWindow.ts'),
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
const nativeMargin = readNumberConstant(files.globalLauncherGeometry, 'STANDALONE_LAUNCHER_VERTICAL_PADDING')
const minRowsBeyondSelected = 3
const minimumUsableLauncherHeight = Math.ceil(
  headerMinHeight +
  readCssVerticalPadding(listBlock) +
  selectedRowHeight +
  rowHeight * minRowsBeyondSelected +
  footerVisibleHeight +
  nativeMargin,
)

const frontendMinHeight = readNumberConstant(files.globalLauncherGeometry, 'STANDALONE_LAUNCHER_MIN_HEIGHT')
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

assert.match(
  files.globalLauncherGeometry,
  /STANDALONE_LAUNCHER_MAX_HEIGHT\s*-\s*STANDALONE_LAUNCHER_VERTICAL_PADDING\s*-\s*header\.offsetHeight\s*-\s*footer\.offsetHeight/,
  'standalone launcher height measurement should restore the list area available at max window height',
)

assert.match(
  files.globalLauncherGeometry,
  /const\s+bodyMaxHeight\s*=\s*Math\.min\(body\.scrollHeight,\s*maxBodyHeight\)/,
  'standalone launcher height measurement should not let the current shrunken window viewport cap future growth',
)

assert.match(
  files.globalLauncherWindowLifecycle,
  /computeStandaloneLauncherGeometry[\s\S]*applyStandaloneLauncherGeometry[\s\S]*resizeCurrentLauncherWindow/,
  'standalone launcher resize lifecycle should use a single geometry calculation for CSS and native size',
)

const transpiledLauncherWindow = ts.transpileModule(files.launcherWindow, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function loadNativeLauncherWindow(bounds = { x: 100, y: 80, width: 600, height: 400 }, scale = 2) {
  const launcherWindowModule = { exports: {} }
  const calls = []
  const reads = []
  const nativeBounds = { ...bounds }
  const nativeWindow = {
    scaleFactor: async () => { reads.push('scaleFactor'); return scale },
    outerPosition: async () => {
      reads.push('outerPosition')
      const { x, y } = nativeBounds
      return { toLogical: (factor) => ({ x: x * scale / factor, y: y * scale / factor }) }
    },
    outerSize: async () => {
      reads.push('outerSize')
      const { width, height } = nativeBounds
      return { toLogical: (factor) => ({ width: width * scale / factor, height: height * scale / factor }) }
    },
    setSize: async (size) => {
      calls.push(['size', size.width, size.height])
      nativeBounds.width = size.width
      nativeBounds.height = size.height
    },
    setPosition: async (position) => {
      calls.push(['position', position.x, position.y])
      nativeBounds.x = position.x
      nativeBounds.y = position.y
    },
  }
  vm.runInNewContext(transpiledLauncherWindow, {
    module: launcherWindowModule,
    exports: launcherWindowModule.exports,
    require(specifier) {
      if (specifier === '@tauri-apps/api/window') {
        reads.push('importWindow')
        return {
          getCurrentWindow: () => { reads.push('getCurrentWindow'); return nativeWindow },
          LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y } },
          LogicalSize: class { constructor(width, height) { this.width = width; this.height = height } },
        }
      }
      if (specifier.endsWith('webNativeBridge')) return { isNativeDesktopRuntime: () => true }
      return new Proxy({}, { get: () => () => {} })
    },
    window: { dispatchEvent: () => calls.push(['programmatic-move']) },
    CustomEvent: class {},
    console,
  })
  return { resize: launcherWindowModule.exports.resizeCurrentLauncherWindow, calls, reads, nativeWindow, nativeBounds }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const ordinary = loadNativeLauncherWindow()
await ordinary.resize({ width: 900, height: 600 })
assert.deepEqual(
  ordinary.calls,
  [['programmatic-move'], ['size', 900, 600], ['position', -50, 80]],
  'native resize should preserve the launcher top center while widening',
)
ordinary.calls.length = 0
await ordinary.resize({ width: 900, height: 600 })
assert.deepEqual(ordinary.calls, [], 'an unchanged native launcher size should not resize or move again')
await ordinary.resize({ width: 900, height: 500 })
assert.deepEqual(
  ordinary.calls,
  [['programmatic-move'], ['size', 900, 500]],
  'a height-only resize should never move the launcher',
)

const negativeOrigin = loadNativeLauncherWindow({ x: -1100, y: -80, width: 660, height: 318 }, 1.5)
await negativeOrigin.resize({ width: 728, height: 400 })
assert.deepEqual(
  negativeOrigin.calls,
  [['programmatic-move'], ['size', 728, 400], ['position', -1134, -80]],
  '660→728 widening should preserve the actual-scale center and negative monitor origin',
)

for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
  for (const size of [{ width: invalid, height: 400 }, { width: 660, height: invalid }]) {
    const rejected = loadNativeLauncherWindow()
    await assert.rejects(rejected.resize(size), /finite and positive/)
    assert.deepEqual(rejected.reads, [], 'invalid dimensions must be rejected before any native operation')
    assert.deepEqual(rejected.calls, [], 'invalid dimensions must not resize, move, or signal a move')
  }
}

const failed = loadNativeLauncherWindow({ x: 100, y: 80, width: 660, height: 318 })
failed.nativeWindow.setSize = async (size) => {
  failed.calls.push(['size', size.width, size.height])
  throw new Error('native resize failed')
}
await assert.rejects(failed.resize({ width: 728, height: 400 }), /native resize failed/)
assert.deepEqual(
  failed.calls,
  [['programmatic-move'], ['size', 728, 400]],
  'a failed native resize must never issue the compensating move',
)
assert.deepEqual(failed.nativeBounds, { x: 100, y: 80, width: 660, height: 318 })

const staleSize = loadNativeLauncherWindow({ x: 100, y: 80, width: 660, height: 318 })
const firstSizeStarted = deferred()
const firstSizeReply = deferred()
const setSize = staleSize.nativeWindow.setSize
staleSize.nativeWindow.setSize = async (size) => {
  await setSize(size)
  if (size.width === 728) {
    firstSizeStarted.resolve()
    await firstSizeReply.promise
  }
}
const oldSize = staleSize.resize({ width: 728, height: 400 })
await firstSizeStarted.promise
assert.deepEqual(
  staleSize.calls,
  [['programmatic-move'], ['size', 728, 400]],
  'movement must wait until native resizing reports success',
)
await staleSize.resize({ width: 800, height: 500 })
const callsBeforeOldReply = [...staleSize.calls]
firstSizeReply.resolve()
await oldSize
assert.deepEqual(staleSize.calls, callsBeforeOldReply, 'a superseded setSize reply must not move the window')
assert.deepEqual(staleSize.nativeBounds, { x: 64, y: 80, width: 800, height: 500 })

const staleBounds = loadNativeLauncherWindow({ x: 100, y: 80, width: 660, height: 318 })
const oldBoundsStarted = deferred()
const oldBoundsReply = deferred()
const outerPosition = staleBounds.nativeWindow.outerPosition
let firstBounds = true
staleBounds.nativeWindow.outerPosition = async () => {
  const position = await outerPosition()
  if (firstBounds) {
    firstBounds = false
    oldBoundsStarted.resolve()
    await oldBoundsReply.promise
  }
  return position
}
const oldBounds = staleBounds.resize({ width: 728, height: 400 })
await oldBoundsStarted.promise
await staleBounds.resize({ width: 800, height: 500 })
const callsBeforeOldBounds = [...staleBounds.calls]
oldBoundsReply.resolve()
await oldBounds
assert.deepEqual(staleBounds.calls, callsBeforeOldBounds, 'superseded bounds must not resize or move the window')

assert.match(
  files.globalLauncherGeometry,
  /surfaceShell\?\.defaultWidth[\s\S]*launcherSettingsTarget[\s\S]*GLOBAL_LAUNCHER_SETTINGS_WIDTH/,
  'settings opened from a plugin surface must preserve the surface window width',
)

assert.match(
  files.globalLauncherGeometry,
  /surfaceShell\?\.defaultHeight[\s\S]*launcherSettingsTarget\s*\?\s*GLOBAL_LAUNCHER_SETTINGS_HEIGHT/,
  'settings opened from a plugin surface must preserve the surface window height',
)

assert.doesNotMatch(
  files.indexCss,
  /html\[data-window='launcher'\]\s+\.global-launcher-panel\.palette-panel\s*\{[\s\S]*?--launcher-list-max-height:\s*calc\(100vh - 130px\)/,
  'standalone launcher CSS must not derive list max height from the current native window height',
)

assert.match(
  files.indexCss,
  /max-height:\s*var\(--launcher-body-max-height,\s*var\(--launcher-list-max-height\)\)/,
  'launcher body should accept geometry-owned body max height',
)

if (failures.length > 0) {
  console.error(`global launcher window height checks failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('global launcher window height checks passed')
