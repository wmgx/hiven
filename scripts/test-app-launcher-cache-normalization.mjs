#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import vm from 'node:vm'

const root = process.cwd()
const modulePath = join(root, 'src/workspace/appLauncher/hostAppIndex.ts')
const launcherPath = join(root, 'src/workspace/appLauncher/hostAppLauncher.ts')

assert.ok(existsSync(modulePath), 'host app index normalization module must exist')
assert.ok(existsSync(launcherPath), 'host app launcher module must exist')

const source = readFileSync(modulePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
})

const sandbox = {
  module: { exports: {} },
  exports: {},
}
sandbox.exports = sandbox.module.exports
vm.runInNewContext(compiled.outputText, sandbox, { filename: modulePath })

const { normalizeHostAppEntries } = sandbox.module.exports
assert.equal(typeof normalizeHostAppEntries, 'function', 'normalizeHostAppEntries must be exported')

const normalized = normalizeHostAppEntries([
  {
    appId: 'macos:path:old-trae',
    name: 'TRAE',
    platform: 'macos',
    source: 'applications',
  },
  {
    appId: 'macos:bundle:com.trae.app',
    name: 'TRAE',
    platform: 'macos',
    source: 'applications',
    displayPath: '/Applications/Trae.app',
    installedAt: 1000,
  },
  {
    appId: 'macos:path:old-work-cn',
    name: 'TRAE Work CN',
    platform: 'macos',
    source: 'applications',
  },
  {
    appId: 'macos:bundle:com.trae.work.cn',
    name: 'TRAE Work CN',
    platform: 'macos',
    source: 'applications',
    displayPath: '/Users/me/Applications/TRAE Work CN.app',
    installedAt: 2000,
  },
])

assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.map((app) => [app.name, app.appId, app.displayPath]))),
  [
    ['TRAE', 'macos:bundle:com.trae.app', '/Applications/Trae.app'],
    ['TRAE Work CN', 'macos:bundle:com.trae.work.cn', '/Users/me/Applications/TRAE Work CN.app'],
  ],
  'same-name historical cache entries should be collapsed and prefer launchable path-backed records',
)

console.log('host app launcher cache normalization checks passed')

const launcherSource = readFileSync(launcherPath, 'utf8')
assert.match(
  launcherSource,
  /refreshHostApplicationIndexOnStartup[\s\S]*refreshApplicationIndex\(\{ force: true \}\)/,
  'startup refresh must force a full latest scan instead of trusting a fresh cache',
)
assert.doesNotMatch(
  launcherSource,
  /apps:\s*\[\s*\.\.\.cache\.apps[\s\S]*\.\.\.apps\s*\]/,
  'application index writes must replace the cached list instead of appending to it',
)
