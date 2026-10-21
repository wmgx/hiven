#!/usr/bin/env node
/**
 * Package ⑦: script-command scaffold + shell.run permission contract.
 *
 * - createPluginScaffoldFiles({ template: 'script-command' }) manifest has shell.run
 * - default template does not request shell.run
 *
 * Run: node scripts/test-script-command-scaffold.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// ── scaffold runtime ────────────────────────────────────────────────────────
function loadScaffold() {
  const filePath = path.join(ROOT, 'src/workspace/pluginScaffold.ts')
  const source = readFileSync(filePath, 'utf8')
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    require: (spec) => {
      throw new Error(`Unexpected require: ${spec}`)
    },
    console,
  }
  // type-only import of pluginTypes is erased by transpile
  vm.runInNewContext(out, sandbox, { filename: filePath })
  return sandbox.module.exports
}

assert.ok(existsSync(path.join(ROOT, 'src/workspace/pluginScaffold.ts')))
const { createPluginScaffoldFiles } = loadScaffold()

const defaultFiles = createPluginScaffoldFiles({
  pluginId: 'demo-plugin',
  title: 'Demo Plugin',
})
assert.ok(
  !defaultFiles.manifest.permissions?.includes('shell.run'),
  'default template must not request shell.run',
)

const scriptFiles = createPluginScaffoldFiles({
  pluginId: 'my-script',
  title: 'My Script',
  template: 'script-command',
})
assert.ok(Array.isArray(scriptFiles.manifest.permissions), 'script-command manifest permissions must be an array')
assert.equal(scriptFiles.manifest.permissions.length, 1, 'script-command should declare exactly one permission')
assert.equal(
  scriptFiles.manifest.permissions[0],
  'shell.run',
  'script-command manifest must declare shell.run',
)
assert.equal(scriptFiles.manifest.pluginId, 'my-script')
// The generated source text is intentionally not asserted (no source-string tests);
// the scaffold now confirms before running ctx.shell, gated by the shell.run permission above.
const keysOf = (json) => Object.keys(JSON.parse(json))
for (const key of ['tool.script.title', 'tool.script.subtitle']) {
  assert.ok(keysOf(scriptFiles.localeEn).includes(key), `en locale defines ${key}`)
  assert.ok(keysOf(scriptFiles.localeZh).includes(key), `zh locale defines ${key}`)
}

console.log('test-script-command-scaffold: ok')
