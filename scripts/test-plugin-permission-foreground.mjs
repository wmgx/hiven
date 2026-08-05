#!/usr/bin/env node
/**
 * Static contract: PluginPermission includes context.foreground-app
 * with localized describePluginPermission labels (en/zh non-empty and different).
 *
 * Host ranking may read foreground without this permission; the key is for
 * future plugin declarations only.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const pluginTypes = read('src/workspace/pluginTypes.ts')
const pluginPermissions = read('src/workspace/pluginPermissions.ts')

const PERMISSION = 'context.foreground-app'
const PERMISSION_RE = /'context\.foreground-app'/

assert.match(pluginTypes, PERMISSION_RE, 'PluginPermission union must include context.foreground-app')
assert.match(
  pluginPermissions,
  /ALL_PLUGIN_PERMISSIONS[\s\S]*'context\.foreground-app'/,
  'ALL_PLUGIN_PERMISSIONS must include context.foreground-app',
)

const labelBlock = pluginPermissions.match(
  /'context\.foreground-app'\s*:\s*\{\s*en:\s*'([^']*)'\s*,\s*zh:\s*'([^']*)'\s*\}/,
)
assert.ok(labelBlock, 'permissionLabels must define context.foreground-app with en and zh')

const [, enLabel, zhLabel] = labelBlock
assert.ok(enLabel.trim().length > 0, 'describePluginPermission en label must be non-empty')
assert.ok(zhLabel.trim().length > 0, 'describePluginPermission zh label must be non-empty')
assert.notEqual(enLabel, zhLabel, 'describePluginPermission en and zh labels must differ')
assert.equal(enLabel, 'Read foreground application', 'en label must match product copy')
assert.equal(zhLabel, '读取前台应用', 'zh label must match product copy')

// Exhaustive Record keys: every ALL entry should appear in permissionLabels
const allMatch = pluginPermissions.match(
  /export const ALL_PLUGIN_PERMISSIONS[^=]*=\s*\[([\s\S]*?)\]/,
)
assert.ok(allMatch, 'could not parse ALL_PLUGIN_PERMISSIONS')
const allPermissions = [...allMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
assert.ok(allPermissions.includes(PERMISSION), 'parsed ALL list must contain context.foreground-app')

const labelsMatch = pluginPermissions.match(
  /const permissionLabels[^=]*=\s*\{([\s\S]*?)\n\}/,
)
assert.ok(labelsMatch, 'could not parse permissionLabels')
const labeledPermissions = [...labelsMatch[1].matchAll(/'([^']+)'\s*:/g)].map((m) => m[1])
for (const permission of allPermissions) {
  assert.ok(
    labeledPermissions.includes(permission),
    `permissionLabels must cover ALL entry: ${permission}`,
  )
}

console.log('test-plugin-permission-foreground: ok')
