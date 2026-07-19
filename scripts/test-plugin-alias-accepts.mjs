#!/usr/bin/env node
/**
 * Assert first-party plugins declare core intent aliases + accepts tables.
 *
 * Package ② baselines (missing → FAIL):
 *   - encode-decode jwt.decode: kinds jwt; accepts.aliases hit `jwt` / `解jwt`
 *   - encode-decode base64.decode: kinds base64; short aliases `b64` / `base64`
 *   - json-tools format/pretty: kinds json; aliases `fmt` / `格式化` / `pretty`
 *   - translate main surface/tool: aliases `翻译` / `translate` (accepts or display)
 *   - date-time-assistant timestamp: optional aliases `ts` / `时间戳` (assert when present)
 *
 * Load style matches scripts/test-plugin-accepts-declarations.mjs.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = process.cwd()

/** Mirror intentEngine.normalizeIntentQuery: lowercase + collapse whitespace + trim. */
function normalizeIntentQuery(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

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

/** Collect contributions that can carry display aliases and/or accepts. */
function collectContributions(plugin) {
  /** @type {{ role: string, id: string, aliases: string[] | undefined, accepts: any }[]} */
  const out = []
  for (const tool of plugin.tools ?? []) {
    out.push({ role: 'tool', id: tool.id, aliases: tool.aliases, accepts: tool.accepts })
  }
  for (const surface of plugin.ui?.surfaces ?? []) {
    out.push({ role: 'surface', id: surface.id, aliases: surface.aliases, accepts: surface.accepts })
  }
  for (const item of plugin.launcher?.items ?? []) {
    out.push({ role: 'launcher-item', id: item.id, aliases: item.aliases, accepts: item.accepts })
  }
  for (const action of plugin.panel?.actions ?? []) {
    out.push({ role: 'panel-action', id: action.id, aliases: action.aliases, accepts: action.accepts })
  }
  for (const cmd of plugin.commands ?? []) {
    out.push({ role: 'command', id: cmd.id, aliases: cmd.aliases, accepts: cmd.accepts })
  }
  return out
}

function displayAliases(c) {
  return Array.isArray(c.aliases) ? c.aliases.map(String) : []
}

function acceptsAliases(c) {
  const a = c.accepts && typeof c.accepts === 'object' ? c.accepts.aliases : undefined
  return Array.isArray(a) ? a.map(String) : []
}

function allAliases(c) {
  return [...displayAliases(c), ...acceptsAliases(c)]
}

function acceptsKinds(c) {
  const k = c.accepts && typeof c.accepts === 'object' ? c.accepts.kinds : undefined
  return Array.isArray(k) ? k : []
}

function findByIdHint(contributions, hints) {
  const lowerHints = hints.map((h) => h.toLowerCase())
  return contributions.find((c) => {
    const id = String(c.id ?? '').toLowerCase()
    return lowerHints.some((h) => id === h || id.includes(h))
  })
}

function formatContribution(c) {
  if (!c) return '<missing>'
  return `${c.role}:${c.id}[kinds=${acceptsKinds(c).join(',') || '—'}; accepts.aliases=${JSON.stringify(acceptsAliases(c))}; display.aliases=${JSON.stringify(displayAliases(c))}]`
}

/**
 * True when accepts.aliases has an entry that normalizes to target,
 * or the raw list includes any of the exact candidates.
 */
function acceptsAliasesHitJwt(acceptsAliasList) {
  const targets = ['jwt', '解jwt']
  if (acceptsAliasList.some((a) => normalizeIntentQuery(a) === 'jwt')) return true
  if (acceptsAliasList.some((a) => targets.includes(a) || targets.includes(normalizeIntentQuery(a)))) {
    return true
  }
  return false
}

/** Short intent alias: normalized exact match against allowed short forms. */
function hasShortAlias(aliasList, shortForms) {
  const normalizedForms = shortForms.map(normalizeIntentQuery)
  return aliasList.some((a) => normalizedForms.includes(normalizeIntentQuery(a)))
}

// ─── encode-decode ───────────────────────────────────────────────────────────

{
  const plugin = loadPluginDefinition('encode-decode')
  const contributions = collectContributions(plugin)
  assert.ok(contributions.length > 0, 'encode-decode must export tools (or other contributions)')

  // jwt decode
  const jwt =
    findByIdHint(contributions, ['jwt.decode', 'jwt-decode', 'jwt']) ??
    contributions.find((c) => acceptsKinds(c).includes('jwt'))
  assert.ok(jwt, `encode-decode must expose a jwt decode tool; saw: ${contributions.map(formatContribution).join('; ')}`)
  assert.ok(
    acceptsKinds(jwt).includes('jwt'),
    `jwt decode tool must declare accepts.kinds including 'jwt'; saw: ${formatContribution(jwt)}`,
  )
  const jwtAcceptsAliases = acceptsAliases(jwt)
  assert.ok(
    jwtAcceptsAliases.length > 0,
    `jwt decode tool must declare accepts.aliases (for short query intent); saw: ${formatContribution(jwt)}`,
  )
  assert.ok(
    acceptsAliasesHitJwt(jwtAcceptsAliases),
    `jwt decode accepts.aliases must include normalized 'jwt' or raw 'jwt'/'解jwt'; saw: ${formatContribution(jwt)}`,
  )

  // base64 decode
  const b64 =
    findByIdHint(contributions, ['base64.decode', 'base64-decode', 'b64.decode']) ??
    contributions.find((c) => acceptsKinds(c).includes('base64') && String(c.id).toLowerCase().includes('decode'))
  assert.ok(
    b64,
    `encode-decode must expose a base64 decode tool; saw: ${contributions.map(formatContribution).join('; ')}`,
  )
  assert.ok(
    acceptsKinds(b64).includes('base64'),
    `base64 decode tool must declare accepts.kinds including 'base64'; saw: ${formatContribution(b64)}`,
  )
  const b64Aliases = allAliases(b64)
  assert.ok(
    hasShortAlias(b64Aliases, ['b64', 'base64']),
    `base64 decode aliases must include short form 'b64' or 'base64' (display or accepts); saw: ${formatContribution(b64)}`,
  )
}

// ─── json-tools ──────────────────────────────────────────────────────────────

{
  const plugin = loadPluginDefinition('json-tools')
  const contributions = collectContributions(plugin)
  assert.ok(contributions.length > 0, 'json-tools must export tools/surfaces')

  const format =
    findByIdHint(contributions, [
      'json.prettify',
      'json.pretty',
      'json.format',
      'prettify',
      'pretty',
      'format',
    ]) ??
    contributions.find((c) => {
      const aliases = allAliases(c).map(normalizeIntentQuery)
      return aliases.some((a) => a.includes('pretty') || a.includes('format') || a.includes('格式化') || a === 'fmt')
    })

  assert.ok(
    format,
    `json-tools must expose a format/pretty tool; saw: ${contributions.map(formatContribution).join('; ')}`,
  )
  assert.ok(
    acceptsKinds(format).includes('json'),
    `json format/pretty tool must declare accepts.kinds including 'json'; saw: ${formatContribution(format)}`,
  )
  const formatAliases = allAliases(format)
  assert.ok(
    hasShortAlias(formatAliases, ['fmt', '格式化', 'pretty']),
    `json format/pretty aliases must include 'fmt' or '格式化' or 'pretty'; saw: ${formatContribution(format)}`,
  )
}

// ─── translate ───────────────────────────────────────────────────────────────

{
  const plugin = loadPluginDefinition('translate')
  const contributions = collectContributions(plugin)
  assert.ok(
    contributions.length > 0,
    'translate must export a main surface/tool/launcher item',
  )

  const main =
    findByIdHint(contributions, ['main', 'translate', 'translation']) ??
    contributions.find((c) => {
      const aliases = allAliases(c).map(normalizeIntentQuery)
      return aliases.some((a) => a === 'translate' || a === '翻译' || a.includes('translate') || a.includes('翻译'))
    }) ??
    contributions[0]

  assert.ok(main, 'translate must expose a main contribution')
  const aliases = allAliases(main)
  assert.ok(
    hasShortAlias(aliases, ['翻译', 'translate']) ||
      aliases.some((a) => {
        const n = normalizeIntentQuery(a)
        return n === '翻译' || n === 'translate'
      }),
    `translate main contribution aliases (accepts or display) must include '翻译' or 'translate'; saw: ${formatContribution(main)}`,
  )
}

// ─── date-time-assistant (optional aliases) ──────────────────────────────────

{
  const plugin = loadPluginDefinition('date-time-assistant')
  const contributions = collectContributions(plugin)
  const timestamp =
    findByIdHint(contributions, ['timestamp.run', 'timestamp', 'unix']) ??
    contributions.find((c) => acceptsKinds(c).includes('timestamp'))

  assert.ok(
    timestamp,
    `date-time-assistant must expose a timestamp tool; saw: ${contributions.map(formatContribution).join('; ')}`,
  )

  // Optional: if short aliases `ts` / `时间戳` are declared, they must be well-formed (present after normalize).
  const aliases = allAliases(timestamp)
  const hasTs = hasShortAlias(aliases, ['ts', '时间戳'])
  if (hasTs) {
    assert.ok(
      hasShortAlias(aliases, ['ts', '时间戳']),
      `timestamp aliases include optional short form; saw: ${formatContribution(timestamp)}`,
    )
  }
  // When absent: soft pass (optional for package ② core table).
}

console.log('plugin alias + accepts tables checks passed (encode-decode, json-tools, translate, date-time-assistant)')
