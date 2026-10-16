#!/usr/bin/env node
/**
 * Least-privilege permission snapshot contract (runs the real pluginPermissions module).
 *
 * Undeclared permissions never default to granted.
 * Builtin declared permissions auto-grant except the denylist (shell.run).
 * Installed/dev declared permissions default denied until user grant.
 * Explicit store grants/denies always win.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Minimal zustand stand-in: enough for create()(persist(initializer)).getState().
const zustand = {
  create: () => (initializer) => {
    let state
    const set = (updater) => { state = { ...state, ...(typeof updater === 'function' ? updater(state) : updater) } }
    state = initializer(set, () => state)
    return { getState: () => state }
  },
}
const middleware = { persist: (initializer) => initializer }

const out = ts.transpileModule(readFileSync('src/workspace/pluginPermissions.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const moduleExports = {}
vm.runInNewContext(out, {
  exports: moduleExports,
  module: { exports: moduleExports },
  require: (name) => {
    if (name === 'zustand') return zustand
    if (name === 'zustand/middleware') return middleware
    throw new Error(`unexpected require: ${name}`)
  },
  Date,
  Set,
})
const perms = moduleExports
const store = perms.usePluginPermissionStore.getState()

// Undeclared permissions are denied, installed declared without grant is denied.
{
  const snap = perms.getPluginPermissionSnapshot('installed', 'p-installed', ['clipboard.read'])
  assert.equal(snap['network.request'].granted, false, 'undeclared network must be denied')
  assert.equal(snap['shell.run'].granted, false, 'undeclared shell must be denied')
  assert.equal(snap['clipboard.read'].granted, false, 'installed declared without grant is denied')
}

// Builtin auto-grants declared non-denylist permissions.
{
  const snap = perms.getPluginPermissionSnapshot('builtin', 'p-builtin', ['clipboard.read', 'network.request', 'shell.run'])
  assert.equal(snap['clipboard.read'].granted, true, 'builtin declared clipboard auto-grants')
  assert.equal(snap['network.request'].granted, true, 'builtin declared network auto-grants')
  assert.equal(snap['shell.run'].granted, false, 'builtin shell stays denylisted')
  assert.equal(snap['storage.private'].granted, false, 'undeclared storage denied for builtin')
}

// Explicit revoke beats builtin auto-grant.
{
  store.revokePermissions('builtin', 'p-revoked', ['clipboard.read'])
  const snap = perms.getPluginPermissionSnapshot('builtin', 'p-revoked', ['clipboard.read'])
  assert.equal(snap['clipboard.read'].granted, false, 'explicit deny wins over builtin auto-grant')
}

// Explicit grant beats installed default deny.
{
  store.grantPermissions('installed', 'p-granted', ['network.request'])
  const snap = perms.getPluginPermissionSnapshot('installed', 'p-granted', ['network.request'])
  assert.equal(snap['network.request'].granted, true, 'explicit grant enables installed plugin')
}

console.log('test-plugin-permission-least-privilege: ok')
