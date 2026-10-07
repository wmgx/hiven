#!/usr/bin/env node
// Execute the real initializer and source capsule. Only Vite's build-time raw
// glob and Tauri IO are supplied by the harness; release decisions are unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const sourceRoot = path.resolve('src')
const configDir = '/test/hiven'
const builtinDir = `${configDir}/plugins/builtin`
const indexPath = `${builtinDir}/index.json`
const manifestPaths = fs.globSync('plugins/*/manifest.json', { cwd: sourceRoot }).sort()
const packages = manifestPaths.map((file) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, file), 'utf8'))
  return { pluginId: manifest.pluginId, dir: file.split('/')[1], version: manifest.version || '1.0.0' }
})
const embeddedIndex = {
  version: JSON.parse(fs.readFileSync(path.join(sourceRoot, 'builtin-plugins/index.json'), 'utf8')).version,
  packages,
}
const sourceFiles = fs.globSync('plugins/*/**/*.{ts,tsx,js,jsx,mjs,json,css,md}', { cwd: sourceRoot }).sort()
const expectedFiles = new Map(sourceFiles.flatMap((file) => {
  const [, dir, ...rest] = file.split('/')
  const pkg = packages.find((entry) => entry.dir === dir)
  return pkg ? [[`${builtinDir}/${pkg.pluginId}/${rest.join('/')}`, fs.readFileSync(path.join(sourceRoot, file), 'utf8')]] : []
}))

function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [context => {
      const visit = node => {
        if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
          return ts.factory.createIdentifier('__importMeta')
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          return ts.factory.updateCallExpression(node, ts.factory.createIdentifier('__importModule'), node.typeArguments, node.arguments)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return node => ts.visitNode(node, visit)
    }] },
  }).outputText
}
const compiled = new Map(['configInit.ts', 'builtinPluginSources.ts'].map(file => [file, compile(file)]))
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const copy = value => JSON.parse(JSON.stringify(value))

function harness({ currentIndex, native = true, extraSources = {}, missingPackage } = {}) {
  const disk = new Map()
  if (currentIndex !== undefined) disk.set(indexPath, JSON.stringify(currentIndex))
  const h = { disk, events: [], globReads: [], errors: [], sourceLoads: 0, commandHook: null, loadHook: null }
  let sourceModule
  function load(file) {
    const exports = {}
    const context = {
      exports, module: { exports },
      window: native ? { __TAURI_INTERNALS__: {} } : {},
      console: { error: (...args) => h.errors.push(args) },
      __importMeta: { glob(pattern, options) {
        assert.equal(options.eager, true)
        assert.equal(options.query, '?raw')
        assert.equal(options.import, 'default')
        const matches = new Map(fs.globSync(pattern, { cwd: sourceRoot }).sort().map(name => [
          `./${name}`, fs.readFileSync(path.join(sourceRoot, name), 'utf8'),
        ]))
        for (const [name, value] of Object.entries(extraSources)) {
          if (path.matchesGlob(name, pattern)) matches.set(name, value)
        }
        for (const name of matches.keys()) {
          if (file === 'builtinPluginSources.ts' && missingPackage && name.startsWith(`./plugins/${missingPackage}/`)) {
            matches.delete(name)
          } else {
            h.globReads.push({ file, name })
          }
        }
        return Object.fromEntries(matches)
      } },
      async __importModule(name) {
        if (name === '@tauri-apps/api/core') return { invoke }
        if (name === './builtinPluginSources') {
          h.sourceLoads++
          h.events.push({ command: 'load_sources' })
          const get = () => sourceModule ??= load('builtinPluginSources.ts')
          return h.loadHook ? h.loadHook(get) : get()
        }
        throw new Error(`Unexpected dependency ${name}`)
      },
    }
    vm.runInNewContext(compiled.get(file), context, { filename: file })
    return context.module.exports
  }
  async function invoke(command, args = {}) {
    h.events.push({ command, ...args })
    await h.commandHook?.(command, args)
    switch (command) {
      case 'init_config_dir': return configDir
      case 'save_plugin_file':
        disk.set(args.path, args.content)
        h.events.push({ command: 'write_complete', path: args.path })
        return
      case 'read_plugin_file':
        if (!disk.has(args.path)) throw new Error(`No file ${args.path}`)
        return disk.get(args.path)
      case 'remove_plugin_dir':
        for (const file of disk.keys()) if (file.startsWith(`${args.rootPath}/${args.pluginId}/`)) disk.delete(file)
        return
      case 'list_plugin_dirs': return [...new Set([...disk.keys()]
        .filter(file => file.startsWith(`${args.path}/`) && file.slice(args.path.length + 1).includes('/'))
        .map(file => file.slice(args.path.length + 1).split('/')[0]))].map(pluginId => ({ pluginId }))
      default: throw new Error(`Unexpected command ${command}`)
    }
  }
  h.api = load('configInit.ts')
  return h
}
const count = (h, command) => h.events.filter(event => event.command === command).length
const sourceReads = h => h.globReads.filter(({ name }) => name.startsWith('./plugins/') && !name.endsWith('/manifest.json'))
function assertReleased(h) {
  for (const [file, content] of expectedFiles) assert.equal(h.disk.get(file), content, file)
  assert.deepEqual(JSON.parse(h.disk.get(indexPath)), embeddedIndex)
  assert.equal(h.events.at(-1).command, 'write_complete')
  assert.equal(h.events.at(-1).path, indexPath, 'success index is the last write')
}
let passed = 0
async function check(name, body) {
  try { await body(); console.log(`PASS ${name}`); passed++ }
  catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1 }
}

await check('first release preserves every current source file and writes the index last', async () => {
  const h = harness()
  h.disk.set(`${builtinDir}/retired/old.js`, 'old')
  assert.equal(await h.api.initConfigDir(), configDir)
  assertReleased(h)
  assert.equal(h.sourceLoads, 1)
  assert.equal(sourceReads(h).length, sourceFiles.filter(file => !file.endsWith('/manifest.json')).length)
  assert.ok(!h.disk.has(`${builtinDir}/retired/old.js`))
  const firstRemoval = h.events.findIndex(event => event.command === 'remove_plugin_dir')
  assert.ok(h.events.findIndex(event => event.command === 'load_sources') < firstRemoval)
  for (const pkg of packages) {
    const removal = h.events.findIndex(event => event.command === 'remove_plugin_dir' && event.pluginId === pkg.pluginId)
    const firstWrite = h.events.findIndex(event => event.command === 'save_plugin_file' && event.path.startsWith(`${builtinDir}/${pkg.pluginId}/`))
    assert.ok(firstWrite > removal, pkg.pluginId)
  }
})

await check('same-version startup reads no plugin sources and still cleans retired packages', async () => {
  const h = harness({ currentIndex: embeddedIndex })
  h.disk.set(`${builtinDir}/retired/old.js`, 'old')
  assert.equal(await h.api.initConfigDir(), configDir)
  assert.equal(h.sourceLoads, 0)
  assert.equal(sourceReads(h).length, 0)
  assert.equal(count(h, 'save_plugin_file'), 3, 'only directory keep files are written')
  assert.ok(!h.disk.has(`${builtinDir}/retired/old.js`))
})

await check('index version upgrade fully replaces packages and clears old entry files', async () => {
  const h = harness({ currentIndex: { ...embeddedIndex, version: embeddedIndex.version - 1 } })
  h.disk.set(`${builtinDir}/${packages[0].pluginId}/obsolete-entry.js`, 'old')
  assert.equal(await h.api.initConfigDir(), configDir)
  assertReleased(h)
  assert.ok(!h.disk.has(`${builtinDir}/${packages[0].pluginId}/obsolete-entry.js`))
})

await check('package version alone triggers release with an unchanged index version', async () => {
  const currentIndex = copy(embeddedIndex)
  currentIndex.packages[0].version += '-previous'
  const h = harness({ currentIndex })
  assert.equal(await h.api.initConfigDir(), configDir)
  assertReleased(h)
  assert.equal(h.sourceLoads, 1)
})

await check('source import failure preserves all old packages and can retry', async () => {
  const currentIndex = { ...embeddedIndex, version: embeddedIndex.version - 1 }
  const h = harness({ currentIndex })
  const oldPath = `${builtinDir}/${packages[0].pluginId}/index.js`
  h.disk.set(oldPath, 'previous usable package')
  h.loadHook = () => { throw new Error('chunk download failed') }
  assert.equal(await h.api.initConfigDir(), null)
  assert.equal(count(h, 'remove_plugin_dir'), 0)
  assert.equal(h.disk.get(oldPath), 'previous usable package')
  assert.deepEqual(JSON.parse(h.disk.get(indexPath)), currentIndex)
  h.loadHook = null
  assert.equal(await h.api.initConfigDir(), configDir)
  assertReleased(h)
})

await check('all package contents must be available before any package is removed', async () => {
  const h = harness({ missingPackage: packages.at(-1).dir })
  h.disk.set(`${builtinDir}/${packages[0].pluginId}/old.js`, 'preserve')
  assert.equal(await h.api.initConfigDir(), null)
  assert.equal(count(h, 'remove_plugin_dir'), 0)
  assert.ok(!h.disk.has(indexPath))
})

await check('concurrent init callers share loading, removal, writes and completion', async () => {
  const h = harness()
  const loading = deferred()
  h.loadHook = get => loading.promise.then(get)
  const first = h.api.initConfigDir(), second = h.api.initConfigDir()
  await tick()
  assert.equal(count(h, 'init_config_dir'), 1)
  assert.equal(h.sourceLoads, 1)
  assert.equal(count(h, 'remove_plugin_dir'), 0)
  loading.resolve()
  assert.deepEqual(await Promise.all([first, second]), [configDir, configDir])
  assertReleased(h)
  assert.equal(count(h, 'remove_plugin_dir'), packages.length)
  assert.equal(h.events.filter(event => event.command === 'save_plugin_file' && event.path === indexPath).length, 1)
  assert.equal(await h.api.initConfigDir(), configDir)
  assert.equal(h.sourceLoads, 1, 'later same-version init rechecks metadata without loading sources')
  assert.equal(count(h, 'init_config_dir'), 2)
})

for (const acrossPackages of [false, true]) {
  await check(`failed release waits for slow writes ${acrossPackages ? 'across packages' : 'within the same package'} before retry`, async () => {
    const currentIndex = { ...embeddedIndex, version: embeddedIndex.version - 1 }
    const h = harness({ currentIndex })
    const failedPath = [...expectedFiles.keys()].find(file => file.startsWith(`${builtinDir}/${packages[0].pluginId}/`))
    const slowPackage = packages[acrossPackages ? 1 : 0]
    const slowPath = [...expectedFiles.keys()].find(file => file !== failedPath && file.startsWith(`${builtinDir}/${slowPackage.pluginId}/`))
    const slow = deferred()
    h.commandHook = (command, args) => {
      if (command !== 'save_plugin_file') return
      if (args.path === failedPath) throw new Error('disk write failed')
      if (args.path === slowPath) return slow.promise
    }
    let settled = false
    const first = h.api.initConfigDir().then(result => { settled = true; return result })
    await tick()
    assert.equal(settled, false)
    assert.deepEqual(JSON.parse(h.disk.get(indexPath)), currentIndex)
    const lateCaller = h.api.initConfigDir()
    await tick()
    assert.equal(count(h, 'init_config_dir'), 1)
    assert.equal(count(h, 'remove_plugin_dir'), packages.length)
    slow.resolve()
    assert.deepEqual(await Promise.all([first, lateCaller]), [null, null])
    assert.deepEqual(JSON.parse(h.disk.get(indexPath)), currentIndex)
    h.commandHook = null
    assert.equal(await h.api.initConfigDir(), configDir)
    assertReleased(h)
    assert.equal(count(h, 'init_config_dir'), 2)
  })
}

await check('directory initialization failure also waits for in-flight keep writes before retry', async () => {
  const h = harness()
  const slow = deferred()
  h.commandHook = (command, args) => {
    if (command !== 'save_plugin_file') return
    if (args.path.endsWith('/installed/.keep')) throw new Error('directory unavailable')
    if (args.path.endsWith('/dev/.keep')) return slow.promise
  }
  let settled = false
  const first = h.api.initConfigDir().then(result => { settled = true; return result })
  await tick()
  const lateCaller = h.api.initConfigDir()
  await tick()
  assert.equal(settled, false)
  assert.equal(count(h, 'init_config_dir'), 1)
  assert.equal(h.sourceLoads, 0)
  slow.resolve()
  assert.deepEqual(await Promise.all([first, lateCaller]), [null, null])
  h.commandHook = null
  assert.equal(await h.api.initConfigDir(), configDir)
  assertReleased(h)
})

await check('all supported file types retain nested paths and exact text bytes', async () => {
  const pkg = packages[0]
  const extraSources = Object.fromEntries(['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'css', 'md'].map(extension => [
    `./plugins/${pkg.dir}/nested/fixture.${extension}`, `字节🙂 ${extension}\r\n\t\u0000\\\"'\u0060\n`,
  ]))
  const h = harness({ extraSources })
  assert.equal(await h.api.initConfigDir(), configDir)
  for (const [file, content] of Object.entries(extraSources)) {
    const destination = `${builtinDir}/${pkg.pluginId}/${file.slice(`./plugins/${pkg.dir}/`.length)}`
    assert.deepEqual(Buffer.from(h.disk.get(destination)), Buffer.from(content), file)
  }
})

await check('browser-only initialization performs no native IO or source loading', async () => {
  const h = harness({ native: false })
  assert.equal(await h.api.initConfigDir(), null)
  assert.equal(h.events.length, 0)
  assert.equal(sourceReads(h).length, 0)
})

console.log(`${passed} builtin release behavior checks passed; ${expectedFiles.size} current source files checked byte-for-byte`)
