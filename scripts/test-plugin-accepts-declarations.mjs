#!/usr/bin/env node
/**
 * Assert first-party plugins declare Intent `accepts.kinds` on tools / surfaces.
 *
 * Package ① baselines:
 *   - date-time-assistant: some tool accepts.kinds includes `timestamp`
 *   - encode-decode: some tool includes `base64`; some tool includes `jwt`
 *   - csv: some tool or surface contribution includes `csv`
 *
 * Loads definePlugin results (mock @hiven/plugin), same style as
 * scripts/test-date-time-assistant.mjs. Missing accepts must FAIL (correct red
 * until production plugins declare them).
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = process.cwd()

function resolvePluginEntry(pluginDir) {
  for (const name of ['index.ts', 'index.tsx', 'index.js', 'index.mjs']) {
    const path = join(ROOT, 'src/plugins', pluginDir, name)
    if (existsSync(path)) return path
  }
  throw new Error(`No plugin entry under src/plugins/${pluginDir}`)
}

/**
 * Transpile + run a plugin entry with mocked @hiven/plugin (definePlugin identity)
 * and stubbed relative imports (surfaces / local modules).
 */
function loadPluginDefinition(pluginDir) {
  const entryPath = resolvePluginEntry(pluginDir)
  const source = readFileSync(entryPath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
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
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === '@hiven/plugin') {
        return {
          definePlugin: (definition) => definition,
          textOutput: (text) => ({ output: { kind: 'text', text } }),
          textError: (text) => ({ output: { kind: 'error', text } }),
        }
      }
      // Local relative imports (e.g. ./CsvSurface) — stub only; accepts live on the definition.
      if (specifier.startsWith('.')) {
        return new Proxy(
          { __esModule: true, default: function Stub() {} },
          {
            get(target, prop) {
              if (prop in target) return target[prop]
              return function NamedStub() {}
            },
          },
        )
      }
      throw new Error(`Unexpected require in ${pluginDir}: ${specifier}`)
    },
  })

  vm.runInContext(transpiled, context, { filename: entryPath })
  const plugin = module.exports.default ?? module.exports
  assert.ok(plugin && typeof plugin === 'object', `${pluginDir} must export a definePlugin definition`)
  return plugin
}

function readManifest(pluginDir) {
  const path = join(ROOT, 'src/plugins', pluginDir, 'manifest.json')
  assert.ok(existsSync(path), `${pluginDir} must ship manifest.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Collect accepts-bearing contributions from the definePlugin result.
 * tools are preferred; csv may use ui.surfaces (or future launcher items).
 */
function collectAcceptsContributions(plugin) {
  /** @type {{ role: string, id: string, accepts: unknown }[]} */
  const out = []
  for (const tool of plugin.tools ?? []) {
    out.push({ role: 'tool', id: tool.id, accepts: tool.accepts })
  }
  for (const surface of plugin.ui?.surfaces ?? []) {
    out.push({ role: 'surface', id: surface.id, accepts: surface.accepts })
  }
  for (const item of plugin.launcher?.items ?? []) {
    out.push({ role: 'launcher-item', id: item.id, accepts: item.accepts })
  }
  for (const action of plugin.panel?.actions ?? []) {
    out.push({ role: 'panel-action', id: action.id, accepts: action.accepts })
  }
  return out
}

function hasAcceptsKind(contributions, kind) {
  return contributions.some((c) => {
    const kinds = c.accepts && typeof c.accepts === 'object' ? c.accepts.kinds : undefined
    return Array.isArray(kinds) && kinds.includes(kind)
  })
}

function formatContributions(contributions) {
  if (contributions.length === 0) return '(no tools/surfaces/launcher items)'
  return contributions
    .map((c) => {
      const kinds = c.accepts && typeof c.accepts === 'object' && Array.isArray(c.accepts.kinds)
        ? c.accepts.kinds.join(',')
        : c.accepts == null
          ? '<missing accepts>'
          : JSON.stringify(c.accepts)
      return `${c.role}:${c.id}[kinds=${kinds}]`
    })
    .join('; ')
}

function assertManifestVersion(pluginDir) {
  const manifest = readManifest(pluginDir)
  assert.equal(typeof manifest.version, 'string', `${pluginDir} manifest.version must be a string`)
  assert.ok(manifest.version.length > 0, `${pluginDir} manifest.version must be non-empty`)
  return manifest.version
}

// ─── manifest.version present (string; bump is implementation's job) ─────────

const dateTimeVersion = assertManifestVersion('date-time-assistant')
const encodeDecodeVersion = assertManifestVersion('encode-decode')
const csvVersion = assertManifestVersion('csv')

// ─── date-time-assistant: tool accepts.kinds includes timestamp ──────────────

{
  const plugin = loadPluginDefinition('date-time-assistant')
  const tools = plugin.tools ?? []
  assert.ok(Array.isArray(tools) && tools.length > 0, 'date-time-assistant must export tools[]')
  const hit = tools.some(
    (tool) => Array.isArray(tool.accepts?.kinds) && tool.accepts.kinds.includes('timestamp'),
  )
  assert.ok(
    hit,
    `date-time-assistant must have a tool with accepts.kinds including 'timestamp'; saw: ${formatContributions(
      collectAcceptsContributions(plugin),
    )}`,
  )
}

// ─── encode-decode: tools for base64 and jwt ─────────────────────────────────

{
  const plugin = loadPluginDefinition('encode-decode')
  const tools = plugin.tools ?? []
  assert.ok(Array.isArray(tools) && tools.length > 0, 'encode-decode must export tools[]')

  const hasBase64 = tools.some(
    (tool) => Array.isArray(tool.accepts?.kinds) && tool.accepts.kinds.includes('base64'),
  )
  const hasJwt = tools.some(
    (tool) => Array.isArray(tool.accepts?.kinds) && tool.accepts.kinds.includes('jwt'),
  )

  assert.ok(
    hasBase64,
    `encode-decode must have a tool with accepts.kinds including 'base64'; saw: ${formatContributions(
      collectAcceptsContributions(plugin),
    )}`,
  )
  assert.ok(
    hasJwt,
    `encode-decode must have a tool with accepts.kinds including 'jwt'; saw: ${formatContributions(
      collectAcceptsContributions(plugin),
    )}`,
  )
}

// ─── csv: tool or surface contribution accepts.kinds includes csv ────────────

{
  const plugin = loadPluginDefinition('csv')
  const contributions = collectAcceptsContributions(plugin)
  assert.ok(
    contributions.length > 0,
    'csv plugin must export tools, ui.surfaces, or launcher items',
  )
  assert.ok(
    hasAcceptsKind(contributions, 'csv'),
    `csv must declare accepts.kinds including 'csv' on a tool/surface (or launcher) contribution; saw: ${formatContributions(
      contributions,
    )}`,
  )
}

console.log(
  `plugin accepts declarations checks passed (date-time-assistant@${dateTimeVersion}, encode-decode@${encodeDecodeVersion}, csv@${csvVersion})`,
)
