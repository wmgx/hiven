#!/usr/bin/env node
/**
 * Contract: clipboard content recommendations evaluate tool `accepts`
 * (via evaluateAccepts) instead of hard-coded kind→action catalogs only.
 *
 * Expects export:
 *   recommendActionsFromToolAccepts(params) → RecommendedAction[]-like
 * from one of:
 *   src/launcher/clipboard/acceptsRecommendation.ts
 *   src/launcher/clipboard/actionRecommendation.ts
 *
 * Rules locked here:
 *   1. Only tools whose accepts pass evaluateAccepts enter results
 *   2. Tools without accepts never appear
 *   3. Same toolId is de-duplicated
 *   4. match() throw is isolated (skips that tool; others still recommended)
 *   4b. match() empty/null filters out the tool (filter semantics, B2)
 *   5. timestamp kind + accepts.kinds:['timestamp'] → hit
 *   6. base64 detection + accepts.kinds:['base64'] → hit
 *   7. csv kind → csv tool
 *   8. jwt kind → jwt tool
 *   9. plain text must not hit jwt-only tools
 *
 * Static red assert:
 *   GlobalLauncherHost must not hardcode empty objectActions = []
 *   and must call a recommend* pipeline.
 *
 * Run: node scripts/test-intent-content-recommend.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CANDIDATE_MODULES = [
  path.join(ROOT, 'src/launcher/clipboard/acceptsRecommendation.ts'),
  path.join(ROOT, 'src/launcher/clipboard/actionRecommendation.ts'),
]

const GLOBAL_HOST = path.join(ROOT, 'src/launcher/hosts/GlobalLauncherHost.tsx')

/**
 * Transpile a TypeScript module graph rooted at `entryPath` with relative
 * `.ts` / extensionless imports resolved against the filesystem.
 */
function loadTsModule(entryPath) {
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
    throw new Error(`Cannot resolve "${specifier}" from ${fromFile} (looked under ${base})`)
  }

  function load(filePath) {
    const abs = path.resolve(filePath)
    if (cache.has(abs)) return cache.get(abs)

    if (!existsSync(abs)) {
      throw new Error(`module missing: ${abs}`)
    }

    const source = readFileSync(abs, 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
      fileName: abs,
    })

    const module = { exports: {} }
    const sandbox = {
      module,
      exports: module.exports,
      console,
      Date,
      JSON,
      Math,
      Number,
      String,
      RegExp,
      Array,
      Object,
      Boolean,
      Error,
      TypeError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Buffer,
      TextEncoder,
      TextDecoder,
      performance: globalThis.performance,
      setTimeout,
      clearTimeout,
      require(specifier) {
        // External packages are not required for pure recommend helpers.
        if (!specifier.startsWith('.')) {
          return {}
        }
        const resolved = resolve(abs, specifier)
        return load(resolved)
      },
    }

    cache.set(abs, module.exports)
    vm.runInNewContext(outputText, sandbox, { filename: abs })
    const exported = sandbox.module.exports
    cache.set(abs, exported)
    return exported
  }

  return load(entryPath)
}

function detection(kind, overrides = {}) {
  return {
    kind,
    confidence: overrides.confidence ?? 0.95,
    normalized: overrides.normalized ?? kind,
  }
}

function tool(partial) {
  return {
    pluginId: partial.pluginId ?? 'test-plugin',
    toolId: partial.toolId,
    title: partial.title ?? partial.toolId,
    titleZh: partial.titleZh,
    icon: partial.icon,
    provider: partial.provider,
    accepts: partial.accepts,
    match: partial.match,
  }
}

function idsOf(actions) {
  return actions.map((a) => a.id ?? a.toolId)
}

function hasTool(actions, toolId) {
  return actions.some((a) => a.id === toolId || a.toolId === toolId)
}

// ─── Resolve recommendActionsFromToolAccepts ─────────────────────────────────

const entry = CANDIDATE_MODULES.find((p) => {
  if (!existsSync(p)) return false
  try {
    const mod = loadTsModule(p)
    return typeof mod.recommendActionsFromToolAccepts === 'function'
  } catch {
    return false
  }
})

assert.ok(
  entry,
  `recommendActionsFromToolAccepts missing — expected export from one of:\n  ${CANDIDATE_MODULES.join('\n  ')}`,
)

const recommendModule = loadTsModule(entry)
const { recommendActionsFromToolAccepts } = recommendModule
assert.equal(
  typeof recommendActionsFromToolAccepts,
  'function',
  `${path.relative(ROOT, entry)} must export recommendActionsFromToolAccepts`,
)

// ─── 1. Only evaluateAccepts hits enter results ──────────────────────────────
{
  const tools = [
    tool({
      toolId: 'jwt-decode',
      pluginId: 'jwt',
      title: 'Decode JWT',
      accepts: { kinds: ['jwt'] },
    }),
    tool({
      toolId: 'csv-open',
      pluginId: 'csv',
      title: 'Open CSV',
      accepts: { kinds: ['csv'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'jwt',
    contentText: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
    detections: [detection('jwt')],
    tools,
  })
  assert.ok(Array.isArray(actions), 'must return an array')
  assert.ok(hasTool(actions, 'jwt-decode'), 'jwt tool must be recommended for jwt content')
  assert.ok(!hasTool(actions, 'csv-open'), 'csv tool must not appear when only jwt accepts hits')
}

// ─── 2. Tools without accepts never appear ───────────────────────────────────
{
  const tools = [
    tool({
      toolId: 'no-accepts-tool',
      pluginId: 'misc',
      title: 'No Accepts',
      // accepts intentionally omitted
    }),
    tool({
      toolId: 'timestamp-convert',
      pluginId: 'date-time-assistant',
      title: 'Convert Timestamp',
      accepts: { kinds: ['timestamp'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'timestamp',
    contentText: '1710000000',
    detections: [detection('timestamp')],
    tools,
  })
  assert.ok(hasTool(actions, 'timestamp-convert'), 'tool with matching accepts must appear')
  assert.ok(
    !hasTool(actions, 'no-accepts-tool'),
    'tool without accepts must never appear in content recommend results',
  )
}

// ─── 3. Same toolId de-duplicated ────────────────────────────────────────────
{
  const tools = [
    tool({
      toolId: 'convert-timestamp',
      pluginId: 'date-time-assistant',
      title: 'Convert Timestamp A',
      accepts: { kinds: ['timestamp'] },
    }),
    tool({
      toolId: 'convert-timestamp',
      pluginId: 'date-time-assistant',
      title: 'Convert Timestamp B',
      accepts: { kinds: ['timestamp'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'timestamp',
    detections: [detection('timestamp')],
    tools,
  })
  const matched = actions.filter((a) => a.id === 'convert-timestamp' || a.toolId === 'convert-timestamp')
  assert.equal(matched.length, 1, 'duplicate toolId must be de-duplicated to a single action')
}

// ─── 4. match() throw does not break other tools ─────────────────────────────
{
  const tools = [
    tool({
      toolId: 'bad-match',
      pluginId: 'plugin-a',
      title: 'Bad Match',
      accepts: { kinds: ['jwt'] },
      match() {
        throw new Error('boom from tool match')
      },
    }),
    tool({
      toolId: 'good-jwt',
      pluginId: 'plugin-b',
      title: 'Good JWT',
      accepts: { kinds: ['jwt'] },
    }),
  ]
  let threw = false
  let actions
  try {
    actions = recommendActionsFromToolAccepts({
      kind: 'jwt',
      detections: [detection('jwt')],
      tools,
    })
  } catch {
    threw = true
  }
  assert.equal(threw, false, 'match throw must be isolated and must not surface')
  assert.ok(Array.isArray(actions), 'must still return an array when a match throws')
  assert.ok(hasTool(actions, 'good-jwt'), 'other tools must still be recommended after a match throw')
  assert.ok(!hasTool(actions, 'bad-match'), 'match throw must filter out that tool (filter semantics)')
}

// ─── 4b. match() empty filters out the tool ──────────────────────────────────
{
  const tools = [
    tool({
      toolId: 'empty-match',
      pluginId: 'plugin-a',
      title: 'Empty Match',
      accepts: { kinds: ['jwt'] },
      match() {
        return []
      },
    }),
    tool({
      toolId: 'pass-match',
      pluginId: 'plugin-b',
      title: 'Pass Match',
      accepts: { kinds: ['jwt'] },
      match() {
        return [{ id: 'hit', confidence: 1, target: { kind: 'command', id: 'pass-match' } }]
      },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'jwt',
    detections: [detection('jwt')],
    tools,
  })
  assert.ok(!hasTool(actions, 'empty-match'), 'empty match() must filter the tool out')
  assert.ok(hasTool(actions, 'pass-match'), 'non-empty match() must keep the tool')
}

// ─── 5. timestamp kind + accepts kinds:['timestamp'] → hit ───────────────────
{
  const tools = [
    tool({
      toolId: 'convert-timestamp',
      pluginId: 'date-time-assistant',
      title: 'Convert Timestamp',
      titleZh: '转换时间戳',
      accepts: { kinds: ['timestamp'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'timestamp',
    contentText: '1710000000',
    detections: [detection('timestamp', { normalized: '1710000000' })],
    tools,
  })
  assert.ok(
    hasTool(actions, 'convert-timestamp'),
    'timestamp kind must recommend tools that accepts.kinds includes timestamp',
  )
}

// ─── 6. base64 detection + accepts kinds:['base64'] → hit ────────────────────
{
  const tools = [
    tool({
      toolId: 'base64-decode',
      pluginId: 'encode-decode-tools',
      title: 'Base64 Decode',
      accepts: { kinds: ['base64'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'text',
    contentText: 'SGVsbG8gV29ybGQ=',
    detections: [detection('base64', { normalized: 'SGVsbG8gV29ybGQ=', confidence: 0.92 })],
    tools,
  })
  assert.ok(
    hasTool(actions, 'base64-decode'),
    'base64 detection must recommend tools that accepts.kinds includes base64',
  )
}

// ─── 7. csv kind → csv tool ──────────────────────────────────────────────────
{
  const tools = [
    tool({
      toolId: 'open-csv-tools-surface',
      pluginId: 'csv',
      title: 'Open CSV Tools Surface',
      accepts: { kinds: ['csv'] },
    }),
    tool({
      toolId: 'decode-jwt',
      pluginId: 'jwt',
      title: 'Decode JWT',
      accepts: { kinds: ['jwt'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'csv',
    contentText: 'name,age\nalice,30',
    detections: [detection('csv')],
    tools,
  })
  assert.ok(hasTool(actions, 'open-csv-tools-surface'), 'csv kind must recommend csv tool')
  assert.ok(!hasTool(actions, 'decode-jwt'), 'csv kind must not recommend jwt-only tool')
}

// ─── 8. jwt kind → jwt tool ──────────────────────────────────────────────────
{
  const tools = [
    tool({
      toolId: 'decode-jwt',
      pluginId: 'jwt',
      title: 'Decode JWT',
      accepts: { kinds: ['jwt'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'jwt',
    contentText: 'eyJhbGciOiJIUzI1NiJ9.e30.sig',
    detections: [detection('jwt')],
    tools,
  })
  assert.ok(hasTool(actions, 'decode-jwt'), 'jwt kind must recommend jwt tool')
}

// ─── 9. plain text does not hit jwt-only tool ────────────────────────────────
{
  const tools = [
    tool({
      toolId: 'decode-jwt',
      pluginId: 'jwt',
      title: 'Decode JWT',
      accepts: { kinds: ['jwt'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'text',
    contentText: 'hello world plain text',
    detections: [detection('text', { confidence: 0.5, normalized: 'hello world plain text' })],
    tools,
  })
  assert.ok(
    !hasTool(actions, 'decode-jwt'),
    'plain text must not recommend tools that only accept jwt',
  )
  assert.equal(
    actions.length,
    0,
    'plain text with only jwt tools should yield empty recommend list',
  )
}

// ─── Result shape smoke (id + title present for hits) ────────────────────────
{
  const tools = [
    tool({
      toolId: 'convert-timestamp',
      pluginId: 'date-time-assistant',
      title: 'Convert Timestamp',
      titleZh: '转换时间戳',
      provider: 'Date Time Assistant',
      accepts: { kinds: ['timestamp'] },
    }),
  ]
  const actions = recommendActionsFromToolAccepts({
    kind: 'timestamp',
    detections: [detection('timestamp')],
    tools,
  })
  assert.equal(actions.length, 1)
  const [action] = actions
  assert.equal(action.id ?? action.toolId, 'convert-timestamp')
  assert.ok(typeof action.title === 'string' && action.title.length > 0, 'title required')
  assert.equal(action.pluginId, 'date-time-assistant')
}

// ─── Static: GlobalLauncherHost must call recommend pipeline ─────────────────
{
  assert.ok(existsSync(GLOBAL_HOST), `GlobalLauncherHost missing: ${GLOBAL_HOST}`)
  const hostSrc = readFileSync(GLOBAL_HOST, 'utf8')

  // Must not hardcode empty object actions (disabled recommend path).
  assert.ok(
    !/const\s+objectActions\s*:\s*RecommendedAction\[\]\s*=\s*\[\s*\]/.test(hostSrc),
    'GlobalLauncherHost must not hardcode `const objectActions: RecommendedAction[] = []` — wire recommend pipeline',
  )

  const usesRecommend =
    /\brecommendActionsFromToolAccepts\b/.test(hostSrc) ||
    /\brecommendActionsWithPlugins\b/.test(hostSrc) ||
    /\brecommendActionsForBlock\b/.test(hostSrc) ||
    /\brecommendActions\b/.test(hostSrc)

  assert.ok(
    usesRecommend,
    'GlobalLauncherHost source must call recommendActions / recommendActionsFromToolAccepts / recommendActionsWithPlugins',
  )
}

console.log('intent content recommend (accepts evaluation) checks passed')
console.log(`  module: ${path.relative(ROOT, entry)}`)
console.log(`  coverage: accepts-hit-only, no-accepts-excluded, toolId-dedupe, match-throw-isolation,`)
console.log(`            timestamp/base64/csv/jwt kinds, plain-text-miss, host recommend pipeline`)
