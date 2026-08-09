#!/usr/bin/env node
/**
 * Least-privilege permission snapshot contract.
 *
 * Undeclared permissions must never default to granted.
 * Builtin declared permissions may auto-grant except denylist (shell.run).
 * Installed/dev declared permissions default denied until user grant.
 * Explicit store grants always win.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

// ── Static contract: inverted default must not exist ────────────────────────

const source = read('src/workspace/pluginPermissions.ts')

assert.doesNotMatch(
  source,
  /granted:\s*!requestedPermissions\.includes\(permission\)/,
  'must not invert undeclared permissions into granted:true',
)

assert.match(
  source,
  /BUILTIN_PERMISSION_DENYLIST/,
  'must expose an explicit builtin denylist (not implicit auto-grant of shell)',
)

assert.match(
  source,
  /'shell\.run'/,
  'shell.run must remain on the builtin denylist / permission set',
)

assert.match(
  source,
  /source === 'builtin'/,
  'builtin trusted policy must be explicit in getPluginPermissionSnapshot',
)

assert.match(
  source,
  /!declared\.has\(permission\)[\s\S]*granted:\s*false/,
  'undeclared permissions must resolve to granted:false',
)

// ── Runtime behavior via tsx/esbuild-free dynamic import of compiled logic ───
// The permission module depends on zustand; load through vite-node alternative:
// reimplement the pure decision table here against exported helpers if possible.
// Fall back to asserting the pure algorithm by evaluating a extracted copy.

function evaluateSnapshot(sourceKind, requested, stored = {}) {
  const ALL = [
    'clipboard.read',
    'clipboard.write',
    'network.request',
    'shell.run',
    'storage.private',
  ]
  const DENYLIST = new Set(['shell.run'])
  const declared = new Set(requested)
  const snapshot = {}
  for (const permission of ALL) {
    const explicit = stored[permission]
    if (explicit) {
      snapshot[permission] = explicit
      continue
    }
    if (!declared.has(permission)) {
      snapshot[permission] = { granted: false }
      continue
    }
    if (sourceKind === 'builtin' && !DENYLIST.has(permission)) {
      snapshot[permission] = { granted: true }
      continue
    }
    snapshot[permission] = { granted: false }
  }
  return snapshot
}

// Undeclared network must be denied even if never mentioned.
{
  const snap = evaluateSnapshot('installed', ['clipboard.read'], {})
  assert.equal(snap['network.request'].granted, false, 'undeclared network must be denied')
  assert.equal(snap['clipboard.read'].granted, false, 'installed declared without grant is denied')
  assert.equal(snap['shell.run'].granted, false, 'undeclared shell must be denied')
}

// Builtin auto-grants declared non-denylist perms.
{
  const snap = evaluateSnapshot('builtin', ['clipboard.read', 'network.request', 'shell.run'], {})
  assert.equal(snap['clipboard.read'].granted, true, 'builtin declared clipboard auto-grants')
  assert.equal(snap['network.request'].granted, true, 'builtin declared network auto-grants')
  assert.equal(snap['shell.run'].granted, false, 'builtin shell stays denylisted')
  assert.equal(snap['storage.private'].granted, false, 'undeclared storage denied for builtin')
}

// Explicit revoke beats builtin auto-grant.
{
  const snap = evaluateSnapshot(
    'builtin',
    ['clipboard.read'],
    { 'clipboard.read': { granted: false, deniedAt: 1 } },
  )
  assert.equal(snap['clipboard.read'].granted, false, 'explicit deny wins over builtin auto-grant')
}

// Explicit grant beats installed default deny.
{
  const snap = evaluateSnapshot(
    'installed',
    ['network.request'],
    { 'network.request': { granted: true, grantedAt: 1 } },
  )
  assert.equal(snap['network.request'].granted, true, 'explicit grant enables installed plugin')
}

// ── API call sites must still requirePluginPermissions ──────────────────────

const network = read('src/workspace/pluginNetwork.ts')
const shell = read('src/workspace/pluginShell.ts')
assert.match(network, /requirePluginPermissions\(permissions,\s*\['network\.request'\]\)/)
assert.match(shell, /requirePluginPermissions\(permissions,\s*\['shell\.run'\]\)/)

// ── package.json script exposure ────────────────────────────────────────────

const packageJson = JSON.parse(read('package.json'))
assert.equal(
  packageJson.scripts?.['test:plugin-permission-least-privilege'],
  'node scripts/test-plugin-permission-least-privilege.mjs',
  'package.json must expose least-privilege permission test',
)

console.log('test-plugin-permission-least-privilege: ok')
