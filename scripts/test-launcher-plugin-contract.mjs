#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(path) {
  return readFileSync(path, 'utf8')
}

function assertBuiltinVersionsMatchManifests() {
  const index = JSON.parse(read('src/builtin-plugins/index.json'))
  assert.equal(typeof index.version, 'number', 'builtin plugin index must have a numeric release version')
  assert.ok(index.version >= 37, 'builtin plugin index version should be bumped after builtin package updates')
  assert.equal(index.packages.some((pkg) => pkg.pluginId === 'core-pane'), false, 'core-pane should no longer ship as a bundled plugin')
  const manifestPackages = readdirSync('src/plugins')
    .filter((dir) => existsSync(join('src/plugins', dir, 'manifest.json')))
    .map((dir) => ({ dir, manifest: JSON.parse(read(`src/plugins/${dir}/manifest.json`)) }))
  assert.deepEqual(
    index.packages.map((pkg) => pkg.pluginId).sort(),
    manifestPackages.map(({ manifest }) => manifest.pluginId).sort(),
    'builtin plugin index should release every first-party plugin directory',
  )
  for (const pkg of index.packages) {
    const manifest = JSON.parse(read(`src/plugins/${pkg.dir}/manifest.json`))
    assert.equal(pkg.version, manifest.version, `${pkg.pluginId} builtin index version should match manifest version`)
  }
}

assertBuiltinVersionsMatchManifests()

console.log('launcher plugin contract checks passed')
