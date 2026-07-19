#!/usr/bin/env node
/**
 * Contract: detectClipboardType must bridge to content-kit primary kind.
 *
 * Locks:
 *   - timestamp / jwt / csv / json samples align between
 *     detectClipboardType(text) and detectContent(text)[0].kind
 *   - clipboardSnapshot.ts must import content-kit (detectContent)
 *
 * Run: node scripts/test-clipboard-content-kit-bridge.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_KIT_ENTRY = path.join(ROOT, 'src/kits/content/index.ts')
const CLIPBOARD_SNAPSHOT = path.join(ROOT, 'src/launcher/clipboard/clipboardSnapshot.ts')

/**
 * Transpile a TypeScript module graph rooted at `entryPath` with relative
 * `.ts` / extensionless imports resolved against the filesystem.
 * Pure modules only — no React / workspace side effects.
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
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Buffer,
      TextEncoder,
      TextDecoder,
      require(specifier) {
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

/**
 * Clipboard snapshot may be standalone today, or later import content-kit.
 * Prefer full graph load; fall back to strip-imports standalone transpile.
 */
function loadClipboardSnapshot() {
  assert.ok(existsSync(CLIPBOARD_SNAPSHOT), `clipboardSnapshot missing: ${CLIPBOARD_SNAPSHOT}`)
  try {
    return loadTsModule(CLIPBOARD_SNAPSHOT)
  } catch (err) {
    // Standalone fallback (no relative imports resolved / non-relative imports)
    const src = readFileSync(CLIPBOARD_SNAPSHOT, 'utf8').replace(
      /import[\s\S]*?from\s*['"][^'"]+['"];?\n/g,
      '',
    )
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
      fileName: CLIPBOARD_SNAPSHOT,
    }).outputText
    const moduleExports = {}
    const sandbox = {
      exports: moduleExports,
      module: { exports: moduleExports },
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
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Buffer,
    }
    vm.runInNewContext(out, sandbox, { filename: CLIPBOARD_SNAPSHOT })
    return sandbox.module.exports
  }
}

// ─── Load modules ─────────────────────────────────────────────────────────────

assert.ok(existsSync(CONTENT_KIT_ENTRY), `content-kit entry missing: ${CONTENT_KIT_ENTRY}`)

const contentKit = loadTsModule(CONTENT_KIT_ENTRY)
const { detectContent } = contentKit
assert.equal(typeof detectContent, 'function', 'content-kit must export detectContent')

const snapshot = loadClipboardSnapshot()
const { detectClipboardType } = snapshot
assert.equal(
  typeof detectClipboardType,
  'function',
  'clipboardSnapshot must export detectClipboardType',
)

/** ContentKind values that also exist on ClipboardDetectedType (shared surface). */
const CLIPBOARD_SHARED_KINDS = new Set([
  'json',
  'url',
  'text',
  'command',
  'secret',
  'unknown',
  'sql',
  'css',
  'xml',
  'csv',
  'jwt',
  'timestamp',
  'secret-like',
  'yaml',
  'query-string',
  'markdown',
])

/**
 * Map content-kit primary detection onto clipboard kind space.
 * Kit-only kinds (base64 / url-encoded / color / tsv) are not required to
 * equal detectClipboardType; when primary is kit-only, skip strict equality
 * and only require that clipboard does not invent a conflicting shared kind
 * for the bridge samples below (samples are chosen to be shared kinds).
 */
function primarySharedKind(text) {
  const results = detectContent(text)
  assert.ok(Array.isArray(results) && results.length > 0, `detectContent(${JSON.stringify(text)}) must be non-empty`)
  // Prefer first result whose kind is in clipboard taxonomy (content-kit may multi-label)
  const shared = results.find((r) => CLIPBOARD_SHARED_KINDS.has(r.kind))
  return (shared ?? results[0]).kind
}

// ─── 1. Key sample contracts (clipboard absolute) ─────────────────────────────

const JWT_SAMPLE = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.sig'

assert.equal(
  detectClipboardType('1710000000'),
  'timestamp',
  "detectClipboardType('1710000000') must be timestamp",
)

assert.equal(
  detectClipboardType(JWT_SAMPLE),
  'jwt',
  'JWT three-segment sample must detect as jwt',
)

assert.equal(
  detectClipboardType('{"a":1}'),
  'json',
  'compact JSON object must detect as json',
)

assert.equal(
  detectClipboardType('a,b\n1,2'),
  'csv',
  'two-line comma table must detect as csv',
)

// ─── 2. Bridge alignment: clipboard kind ↔ content-kit primary shared kind ───

const ALIGNMENT_SAMPLES = [
  { input: '1710000000', expected: 'timestamp', label: 'unix-seconds' },
  { input: '1710000000000', expected: 'timestamp', label: 'unix-millis' },
  { input: JWT_SAMPLE, expected: 'jwt', label: 'jwt' },
  { input: '{"a":1}', expected: 'json', label: 'json-object' },
  { input: '[1,2,3]', expected: 'json', label: 'json-array' },
  { input: 'a,b\n1,2', expected: 'csv', label: 'csv-table' },
]

for (const { input, expected, label } of ALIGNMENT_SAMPLES) {
  const clipKind = detectClipboardType(input)
  const contentKind = primarySharedKind(input)
  const contentPrimary = detectContent(input)[0]?.kind

  assert.equal(
    clipKind,
    expected,
    `${label}: detectClipboardType must be ${expected}, got ${clipKind}`,
  )

  // Primary content-kit hit for these samples must be the same shared kind
  // (or multi-label still surfaces it as primary/shared).
  assert.equal(
    contentKind,
    expected,
    `${label}: content-kit primary shared kind must be ${expected}, got ${contentKind} (primary=${contentPrimary})`,
  )

  assert.equal(
    clipKind,
    contentKind,
    `${label}: detectClipboardType (${clipKind}) must align with content-kit shared primary (${contentKind})`,
  )
}

// ─── 3. Static bridge requirement: clipboardSnapshot must import content-kit ─
// Task2 implementation: detectClipboardType delegates to detectContent.
// This assertion is intentionally red until the bridge lands.

const clipboardSource = readFileSync(CLIPBOARD_SNAPSHOT, 'utf8')

const importsContentKit =
  /from\s+['"][^'"]*kits\/content(?:\/[^'"]*)?['"]/.test(clipboardSource) ||
  /from\s+['"][^'"]*\/content(?:\/index)?['"]/.test(clipboardSource) ||
  /import\s*\{[^}]*\bdetectContent\b[^}]*\}\s*from\s+['"][^'"]+['"]/.test(clipboardSource) ||
  /\bdetectContent\b/.test(clipboardSource) &&
    /from\s+['"][^'"]*content[^'"]*['"]/.test(clipboardSource)

assert.ok(
  importsContentKit,
  'clipboardSnapshot.ts must import content-kit (kits/content or detectContent) so detectClipboardType bridges to detectContent',
)

console.log('clipboard ↔ content-kit bridge contract checks passed')
