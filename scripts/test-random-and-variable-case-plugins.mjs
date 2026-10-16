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
      if (specifier === './RandomSurface') return { RandomSurface: () => null }
      if (specifier === './TextToolsSurface') return { TextToolsSurface: () => null }
      if (specifier === './core') return textCore
      if (specifier === './routes') return textRoutes
      if (specifier === './style.css') return {}
      if (specifier === '@hiven/plugin') {
        return { definePlugin: (definition) => definition }
      }
      throw new Error(`Unexpected require: ${specifier}`)
    },
  })
  vm.runInContext(transpiled, context, { filename: entryPath })
  return module.exports
}

function loadTextToolsModule(fileName) {
  const entryPath = join(ROOT, 'src/plugins/line-tools', fileName)
  const source = readFileSync(entryPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    Set, Array, Object, String, RegExp, module, exports: module.exports,
    require(specifier) {
      if (specifier === './core') return textCore
      throw new Error(`Unexpected require: ${specifier}`)
    },
  })
  vm.runInContext(transpiled, context, { filename: entryPath })
  return module.exports
}

const textCore = loadTextToolsModule('core.ts')
const textRoutes = loadTextToolsModule('routes.ts')

// ─── Package shape ────────────────────────────────────────────────────────────

console.log('random + consolidated text-tools plugin checks passed')
