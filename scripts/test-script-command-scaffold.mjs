#!/usr/bin/env node
/**
 * Package ⑦: script-command scaffold + shell.run permission contract.
 *
 * - PluginPermission ALL includes shell.run with en/zh labels
 * - createPluginScaffoldFiles({ template: 'script-command' }) manifest has shell.run
 * - default template does not request shell.run
 * - scaffold index does not execute real shell
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
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

// ── permission contract ─────────────────────────────────────────────────────
const pluginTypes = read('src/workspace/pluginTypes.ts')
const pluginPermissions = read('src/workspace/pluginPermissions.ts')

assert.match(pluginTypes, /'shell\.run'/, 'PluginPermission union must include shell.run')
assert.match(
  pluginPermissions,
  /ALL_PLUGIN_PERMISSIONS[\s\S]*'shell\.run'/,
  'ALL_PLUGIN_PERMISSIONS must include shell.run',
)

const labelBlock = pluginPermissions.match(
  /'shell\.run'\s*:\s*\{\s*en:\s*'([^']*)'\s*,\s*zh:\s*'([^']*)'\s*\}/,
)
assert.ok(labelBlock, 'permissionLabels must define shell.run with en and zh')
const [, enLabel, zhLabel] = labelBlock
assert.equal(enLabel, 'Run shell commands', 'en label for shell.run')
assert.equal(zhLabel, '运行 Shell 命令', 'zh label for shell.run')

// Exhaustive: every ALL entry labeled
const allMatch = pluginPermissions.match(
  /export const ALL_PLUGIN_PERMISSIONS[^=]*=\s*\[([\s\S]*?)\]/,
)
assert.ok(allMatch, 'could not parse ALL_PLUGIN_PERMISSIONS')
const allPermissions = [...allMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
assert.ok(allPermissions.includes('shell.run'), 'parsed ALL must contain shell.run')

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
assert.match(scriptFiles.indexSource, /tools:\s*\[/, 'script-command index must use tools')
assert.match(
  scriptFiles.indexSource,
  /Script command template — wire shell runtime to enable|tool\.script\.placeholder/,
  'script-command run must return placeholder text, not execute shell',
)
assert.doesNotMatch(
  scriptFiles.indexSource,
  /child_process|execSync|spawn\(|invoke\(\s*['"]run_shell|shell\.run\(/,
  'script-command template must not execute real shell commands',
)
assert.match(scriptFiles.localeEn, /tool\.script\.title/, 'en locale keys required')
assert.match(scriptFiles.localeZh, /tool\.script\.title/, 'zh locale keys required')
assert.match(scriptFiles.localeZh, /脚本命令模板/, 'zh locale should localize subtitle/placeholder')

// createDevPluginScaffold should accept template option (API surface)
const runtimeSrc = read('src/workspace/pluginRuntime.ts')
assert.match(
  runtimeSrc,
  /template\?:\s*'default'\s*\|\s*'script-command'|template\?:/,
  'createDevPluginScaffold must accept template option',
)
assert.match(
  runtimeSrc,
  /createPluginScaffoldFiles\(\{[\s\S]*template:\s*options\.template/,
  'createDevPluginScaffold must pass template into scaffold',
)

console.log('test-script-command-scaffold: ok')
