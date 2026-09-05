#!/usr/bin/env node
/**
 * Contract + pure-logic checks for first-party random / variable-case plugins.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import crypto from 'node:crypto'

const ROOT = process.cwd()

function loadPluginModule(pluginDir) {
  const entryPath = join(ROOT, 'src/plugins', pluginDir, 'index.ts')
  assert.ok(existsSync(entryPath), `missing ${entryPath}`)
  const source = readFileSync(entryPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText

  const module = { exports: {} }
  const context = vm.createContext({
    Date,
    Number,
    Math,
    String,
    RegExp,
    Array,
    Object,
    JSON,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    console,
    Buffer,
    TextEncoder,
    TextDecoder,
    crypto,
    Uint8Array,
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === '@hiven/plugin') {
        return { definePlugin: (definition) => definition }
      }
      throw new Error(`Unexpected require: ${specifier}`)
    },
  })
  vm.runInContext(transpiled, context, { filename: entryPath })
  return module.exports
}

// ─── Package shape ────────────────────────────────────────────────────────────

for (const dir of ['random', 'variable-case']) {
  const base = join(ROOT, 'src/plugins', dir)
  assert.ok(existsSync(join(base, 'manifest.json')), `${dir}/manifest.json missing`)
  assert.ok(existsSync(join(base, 'index.ts')), `${dir}/index.ts missing`)
  assert.ok(existsSync(join(base, 'locales/en.json')), `${dir}/locales/en.json missing`)
  assert.ok(existsSync(join(base, 'locales/zh.json')), `${dir}/locales/zh.json missing`)

  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'))
  assert.equal(manifest.pluginId, dir)
  assert.ok(manifest.displayName)
  assert.ok(manifest.displayNameI18n?.zh)
  assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.includes('command'))

  const en = JSON.parse(readFileSync(join(base, 'locales/en.json'), 'utf8'))
  const zh = JSON.parse(readFileSync(join(base, 'locales/zh.json'), 'utf8'))
  for (const key of Object.keys(en)) {
    assert.ok(key in zh, `${dir}: zh locale missing key ${key}`)
  }
  for (const key of Object.keys(zh)) {
    assert.ok(key in en, `${dir}: en locale missing key ${key}`)
  }
}

// ─── variable-case pure logic ─────────────────────────────────────────────────

const vc = loadPluginModule('variable-case')
assert.ok(vc.splitWords && vc.joinWords && vc.convertText && vc.variableCasePlugin)

function assertWords(input, expected) {
  // VM-realm arrays are not deepStrictEqual-compatible with host arrays
  assert.equal(JSON.stringify([...vc.splitWords(input)]), JSON.stringify(expected), input)
}

assertWords('userName', ['user', 'name'])
assertWords('UserName', ['user', 'name'])
assertWords('user_name', ['user', 'name'])
assertWords('user-name', ['user', 'name'])
assertWords('HTTPServer', ['http', 'server'])
assertWords('user.name', ['user', 'name'])
assertWords('user/name', ['user', 'name'])
assertWords('XMLHttpRequest', ['xml', 'http', 'request'])

assert.equal(vc.convertText('user_name', 'camel'), 'userName')
assert.equal(vc.convertText('userName', 'snake'), 'user_name')
assert.equal(vc.convertText('userName', 'pascal'), 'UserName')
assert.equal(vc.convertText('userName', 'constant'), 'USER_NAME')
assert.equal(vc.convertText('userName', 'kebab'), 'user-name')
assert.equal(vc.convertText('userName', 'train'), 'User-Name')
assert.equal(vc.convertText('userName', 'dot'), 'user.name')
assert.equal(vc.convertText('userName', 'path'), 'user/name')
assert.equal(vc.convertText('userName', 'lower'), 'user name')
assert.equal(vc.convertText('userName', 'upper'), 'USER NAME')
assert.equal(vc.convertText('userName', 'title'), 'User Name')

assert.equal(
  vc.convertText('userName\norderId\n', 'snake'),
  'user_name\norder_id\n',
)

const vcTools = vc.variableCasePlugin.tools
assert.ok(Array.isArray(vcTools) && vcTools.length >= 11)
const vcIds = new Set(vcTools.map((t) => t.id))
for (const id of [
  'case.camel',
  'case.pascal',
  'case.snake',
  'case.constant',
  'case.kebab',
  'case.train',
  'case.dot',
  'case.path',
  'case.lower-words',
  'case.upper-words',
  'case.title-words',
]) {
  assert.ok(vcIds.has(id), `variable-case missing tool ${id}`)
}

// ─── random pure logic ────────────────────────────────────────────────────────

const rnd = loadPluginModule('random')
assert.ok(rnd.randomInt && rnd.randomString && rnd.randomUuid && rnd.randomPlugin)

for (let i = 0; i < 40; i++) {
  const n = rnd.randomInt(1, 6)
  assert.ok(n >= 1 && n <= 6, `randomInt out of range: ${n}`)
}
assert.equal(rnd.randomInt(5, 5), 5)

const s = rnd.randomString(12, 'numeric')
assert.equal(s.length, 12)
assert.match(s, /^\d{12}$/)

const hex = rnd.randomString(8, 'hex')
assert.match(hex, /^[0-9a-f]{8}$/)

const uuid = rnd.randomUuid()
assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

const pwd = rnd.randomPassword(16)
assert.equal(pwd.length, 16)
assert.match(pwd, /[a-z]/)
assert.match(pwd, /[A-Z]/)
assert.match(pwd, /\d/)

assert.match(rnd.randomColor(), /^#[0-9a-f]{6}$/)
assert.ok(['true', 'false'].includes(rnd.randomBoolean()))

const f = rnd.randomFloat(0, 1, 3)
assert.match(f, /^\d+\.\d{3}$/)
const fv = Number(f)
assert.ok(fv >= 0 && fv <= 1)

assert.equal(rnd.randomHex(4).length, 8)

const rndTools = rnd.randomPlugin.tools
assert.ok(Array.isArray(rndTools) && rndTools.length >= 8)
const rndIds = new Set(rndTools.map((t) => t.id))
for (const id of [
  'random.integer',
  'random.float',
  'random.string',
  'random.uuid',
  'random.password',
  'random.hex',
  'random.color',
  'random.boolean',
]) {
  assert.ok(rndIds.has(id), `random missing tool ${id}`)
}

for (const tool of rndTools) {
  assert.equal(tool.inputPolicy, undefined, `${tool.id} should quick-run without asking for unrelated source text`)
  if (tool.params) {
    for (const p of tool.params) {
      assert.notEqual(p.default, undefined, `${tool.id} param ${p.key} should have default`)
    }
  }
  assert.notEqual(tool.requireParamSelection, true, `${tool.id} should allow default-run`)
}

for (const dir of ['random', 'variable-case']) {
  const src = readFileSync(join(ROOT, 'src/plugins', dir, 'index.ts'), 'utf8')
  assert.match(src, /from '@hiven\/plugin'/)
  assert.doesNotMatch(src, /from ['"]\.\.\/\.\.\/workspace/)
  assert.doesNotMatch(src, /from ['"]\.\.\/\.\.\/store/)
}

console.log('random + variable-case plugin checks passed')
