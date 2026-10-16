#!/usr/bin/env node
/**
 * Soft nav de-dup: title near-duplicate + capability tier demotion.
 * Exercises the real browserWindowPolicy module.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync('src/workspace/desktopTargets/browserWindowPolicy.ts', 'utf8')
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const moduleExports = {}
vm.runInNewContext(out, { exports: moduleExports, module: { exports: moduleExports }, WeakMap, Math, Object })
const { navNearDuplicateDemotion, navTitlesNearDuplicate } = moduleExports

const windowItem = {
  systemKey: 'host.window:focus:native:1',
  requiredCapabilities: ['desktop-windows'],
  display: { title: 'RFC design notes' },
}
const tabItem = {
  systemKey: 'browser.chromium:tab:9',
  requiredCapabilities: ['desktop-browser-tabs'],
  display: { title: 'RFC design notes' },
}
const otherWindow = {
  systemKey: 'host.window:focus:native:2',
  requiredCapabilities: ['desktop-windows'],
  display: { title: 'Meeting notes' },
}
const peers = [windowItem, tabItem, otherWindow]

assert.equal(navNearDuplicateDemotion(windowItem, peers), 700, 'window demoted when tab has same title')
assert.equal(navNearDuplicateDemotion(tabItem, peers), 0, 'tab not demoted')
assert.equal(navNearDuplicateDemotion(otherWindow, peers), 0, 'unrelated window not demoted')
assert.ok(navTitlesNearDuplicate('Docs — work', 'Docs'))
assert.ok(!navTitlesNearDuplicate('ab', 'abcdef'))

console.log('soft browser window/tab dedup checks passed')
