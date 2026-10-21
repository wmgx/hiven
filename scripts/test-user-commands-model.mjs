#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const moduleExports = {}
  vm.runInNewContext(out, {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    Object,
    Array,
    String,
    Number,
    Boolean,
  })
  return moduleExports
}

const model = load('src/plugins/user-commands/model.ts')
const settings = model.normalizeUserCommandsSettings({
  enabled: true,
  commands: [
    { id: '1', title: 'Echo', command: 'echo hi', enabled: true },
    { id: '2', title: 'Off', command: 'true', enabled: false },
    { id: '3', title: 'Empty', command: '  ', enabled: true },
  ],
})
const enabled = model.enabledUserCommands(settings)
assert.equal(enabled.length, 1)
assert.equal(enabled[0].id, '1')
assert.equal('requireConfirm' in enabled[0], false)
assert.equal(model.DEFAULT_USER_COMMANDS_SETTINGS.commands.length, 0)
const migrated = model.migrateUserCommandsSettings({ enabled: true, commands: [
  { id: 'echo-hello', title: 'Echo hello', command: 'echo "hello from hiven"' },
  { id: 'echo-hello-2', title: 'Mine', command: 'echo mine' },
] })
assert.equal(migrated.commands.map((c) => c.id).join(), 'echo-hello-2')

const manifest = JSON.parse(readFileSync('src/plugins/user-commands/manifest.json', 'utf8'))
assert.ok(manifest.permissions.includes('shell.run'))

console.log('✓ test-user-commands-model passed')
