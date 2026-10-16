#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'))

const manifestJson = readJson('src/plugins/translate/manifest.json')
assert.equal(manifestJson.pluginId, 'translate', 'manifest pluginId must be translate')
assert.deepEqual(
  manifestJson.capabilities?.sort(),
  ['settings', 'ui'].sort(),
  'translate is an app surface plugin with settings and ui capabilities only',
)
assert.deepEqual(
  manifestJson.permissions?.sort(),
  ['ai.use', 'clipboard.read', 'clipboard.write', 'globalShortcut.register', 'network.request', 'storage.private'].sort(),
  'translate should request host AI plus storage, network, clipboard and global shortcut access',
)

const builtin = readJson('src/builtin-plugins/index.json')
assert.ok(
  builtin.packages.some((pkg) => pkg.pluginId === 'translate' && pkg.dir === 'translate'),
  'builtin plugin index must include translate package',
)

console.log('translate plugin contract checks passed')
