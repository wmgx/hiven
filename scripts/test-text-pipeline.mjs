#!/usr/bin/env node
/**
 * Linear text pipeline MVP contract:
 *  - register → run multi-step → correct output
 *  - list non-empty after builtins
 *  - host provider wires pipeline items
 *
 * Run: node scripts/test-text-pipeline.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadTsModule(entryPath, stubs = {}) {
  const cache = new Map()

  function resolve(fromFile, specifier) {
    if (!specifier.startsWith('.')) {
      throw new Error(`Unexpected non-relative import "${specifier}" from ${fromFile}`)
    }
    const base = path.resolve(path.dirname(fromFile), specifier)
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
        return candidate
      }
    }
    throw new Error(`Cannot resolve "${specifier}" from ${fromFile}`)
  }

  function load(filePath) {
    if (cache.has(filePath)) return cache.get(filePath).exports

    const source = readFileSync(filePath, 'utf8')
    const rewritten = source.replace(
      /from\s+['"](\.[^'"]+)['"]/g,
      (full, spec) => {
        // Strip type-only imports before transpile for simpler sandbox
        return full
      },
    )
    const out = ts.transpileModule(rewritten, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
      fileName: filePath,
    }).outputText

    const moduleExports = {}
    const module = { exports: moduleExports }
    const sandbox = {
      exports: moduleExports,
      module,
      require: (spec) => {
        if (stubs[spec]) return stubs[spec]
        if (!spec.startsWith('.')) {
          throw new Error(`Unhandled require("${spec}") from ${filePath}`)
        }
        return load(resolve(filePath, spec))
      },
      console,
      process,
      Buffer,
      URL,
      setTimeout,
      clearTimeout,
      __dirname: path.dirname(filePath),
      __filename: filePath,
    }
    cache.set(filePath, module)
    vm.runInNewContext(out, sandbox, { filename: filePath })
    return module.exports
  }

  return load(entryPath)
}

// pipeline.ts only imports Locale type + minifyJsonText from editorTextTransforms.
// editorTextTransforms is pure — load it with the module graph.
const pipelinePath = path.join(ROOT, 'src/workflow/pipeline.ts')
const pipeline = loadTsModule(pipelinePath)

// Reset registry for deterministic tests
pipeline.clearTextPipelinesForTests()

// ── register custom multi-step pipeline ─────────────────────────────────────
pipeline.registerTextPipeline({
  id: 'test-double-pipe',
  title: 'Double Pipe',
  steps: [
    { id: 'trim', title: 'Trim', run: (s) => s.trim() },
    { id: 'upper', title: 'Upper', run: (s) => s.toUpperCase() },
    { id: 'wrap', title: 'Wrap', run: (s) => `[${s}]` },
  ],
})

const listed = pipeline.listTextPipelines()
assert.ok(listed.length >= 1, 'listTextPipelines should be non-empty after register')
assert.ok(
  listed.some((p) => p.id === 'test-double-pipe'),
  'registered pipeline must appear in list',
)

const multiOut = await pipeline.runTextPipeline(
  listed.find((p) => p.id === 'test-double-pipe'),
  '  hello world  ',
)
assert.equal(multiOut, '[HELLO WORLD]', 'multi-step pipeline output must chain correctly')

// ── builtins ────────────────────────────────────────────────────────────────
pipeline.registerBuiltinTextPipelines()
const afterBuiltins = pipeline.listTextPipelines()
assert.ok(afterBuiltins.length >= 2, 'builtins must register at least 2 pipelines')
assert.ok(afterBuiltins.some((p) => p.id === 'trim-uppercase'), 'trim-uppercase builtin required')
assert.ok(afterBuiltins.some((p) => p.id === 'json-minify'), 'json-minify builtin required')

const trimUpper = afterBuiltins.find((p) => p.id === 'trim-uppercase')
const builtOut = await pipeline.runTextPipeline(trimUpper, '  ab cd  ')
assert.equal(builtOut, 'AB CD', 'trim-uppercase builtin must work')

const jsonMin = afterBuiltins.find((p) => p.id === 'json-minify')
const minOut = await pipeline.runTextPipeline(jsonMin, '{\n  "a": 1\n}')
assert.equal(minOut, '{"a":1}', 'json-minify builtin must compact JSON')

let threw = false
try {
  await pipeline.runTextPipeline(jsonMin, 'not-json')
} catch {
  threw = true
}
assert.ok(threw, 'json-minify must reject invalid JSON')

// Idempotent builtins
pipeline.registerBuiltinTextPipelines()
assert.equal(
  pipeline.listTextPipelines().filter((p) => p.id === 'trim-uppercase').length,
  1,
  'registerBuiltinTextPipelines must be idempotent',
)

// ── static source wiring ────────────────────────────────────────────────────
const hostProvider = readFileSync(path.join(ROOT, 'src/workspace/launcher/hostProvider.ts'), 'utf8')
assert.match(hostProvider, /getTextPipelineLauncherItems/, 'hostProvider must include pipeline launcher items')
assert.match(hostProvider, /registerBuiltinTextPipelines/, 'hostProvider must register builtin pipelines')

const pipelineLauncher = readFileSync(path.join(ROOT, 'src/workflow/pipelineLauncher.ts'), 'utf8')
assert.match(pipelineLauncher, /host:pipeline:/, 'pipeline systemKey must use host:pipeline: prefix')
assert.match(pipelineLauncher, /global-launcher/, 'pipeline items must surface on global-launcher')
assert.match(pipelineLauncher, /editor-command-bar/, 'pipeline items must surface on editor-command-bar')
assert.match(pipelineLauncher, /textResult|copyText/, 'pipeline execute must produce text output path')

const workflowIndex = readFileSync(path.join(ROOT, 'src/workflow/index.ts'), 'utf8')
assert.match(workflowIndex, /runTextPipeline/, 'workflow index must export runTextPipeline')
assert.match(workflowIndex, /listTextPipelines/, 'workflow index must export listTextPipelines')

console.log('test-text-pipeline: ok')
