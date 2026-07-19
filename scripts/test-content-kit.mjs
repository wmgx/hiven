#!/usr/bin/env node
/**
 * content-kit detectContent pure-function tests
 *
 * Expects:
 *   src/kits/content/index.ts  re-exporting detectContent
 *   detectContent(text) → ContentDetection[]
 *   ContentDetection = { kind, confidence, normalized, captures? }
 *
 * Run: node scripts/test-content-kit.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTENT_KIT_ENTRY = path.join(ROOT, 'src/kits/content/index.ts')

/**
 * Transpile a TypeScript module graph rooted at `entryPath` with relative
 * `.ts` / extensionless imports resolved against the filesystem.
 * Pure kits only — no React, no workspace imports.
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
      throw new Error(`content-kit module missing: ${abs}`)
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

    // Register early for circular deps
    cache.set(abs, module.exports)
    vm.runInNewContext(outputText, sandbox, { filename: abs })
    // Prefer module.exports if reassigned (CJS interop)
    const exported = sandbox.module.exports
    cache.set(abs, exported)
    return exported
  }

  return load(entryPath)
}

// ─── Load content-kit ─────────────────────────────────────────────────────────
// Expected fail until implementation lands: module / export missing.
assert.ok(
  existsSync(CONTENT_KIT_ENTRY),
  `content-kit entry missing: ${CONTENT_KIT_ENTRY}`,
)

const contentKit = loadTsModule(CONTENT_KIT_ENTRY)
const { detectContent } = contentKit
assert.equal(typeof detectContent, 'function', 'content-kit must export detectContent')

function kindsOf(results) {
  return results.map((item) => item.kind)
}

function findKind(results, kind) {
  return results.find((item) => item.kind === kind)
}

function assertDetectionShape(results, label) {
  assert.ok(Array.isArray(results), `${label}: detectContent must return an array`)
  for (const item of results) {
    assert.equal(typeof item.kind, 'string', `${label}: kind must be string`)
    assert.equal(typeof item.confidence, 'number', `${label}: confidence must be number`)
    assert.ok(item.confidence >= 0 && item.confidence <= 1, `${label}: confidence in [0,1]`)
    assert.equal(typeof item.normalized, 'string', `${label}: normalized must be string`)
    if (item.captures !== undefined) {
      assert.equal(typeof item.captures, 'object', `${label}: captures must be object when present`)
    }
  }
}

// ─── 1. Unix 秒级时间戳（10 位）→ timestamp, confidence ≥ 0.9 ────────────────
{
  const input = '1710000000'
  const results = detectContent(input)
  assertDetectionShape(results, 'unix-seconds')
  const hit = findKind(results, 'timestamp')
  assert.ok(hit, `unix seconds should detect timestamp; got kinds=${JSON.stringify(kindsOf(results))}`)
  assert.ok(
    hit.confidence >= 0.9,
    `unix seconds timestamp confidence should be ≥ 0.9, got ${hit.confidence}`,
  )
}

// ─── 2. 毫秒时间戳（13 位）→ timestamp ───────────────────────────────────────
{
  const input = '1710000000000'
  const results = detectContent(input)
  assertDetectionShape(results, 'unix-millis')
  const hit = findKind(results, 'timestamp')
  assert.ok(hit, `unix millis should detect timestamp; got kinds=${JSON.stringify(kindsOf(results))}`)
}

// ─── 3. 标准 JWT 三段 → jwt ──────────────────────────────────────────────────
{
  const input = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.sig'
  const results = detectContent(input)
  assertDetectionShape(results, 'jwt')
  const hit = findKind(results, 'jwt')
  assert.ok(hit, `JWT should detect jwt; got kinds=${JSON.stringify(kindsOf(results))}`)
}

// ─── 4. 合法 base64 → base64；普通英文词不得高置信 base64 ───────────────────
{
  const input = 'SGVsbG8gV29ybGQ='
  const results = detectContent(input)
  assertDetectionShape(results, 'base64-valid')
  const hit = findKind(results, 'base64')
  assert.ok(hit, `valid base64 should detect base64; got kinds=${JSON.stringify(kindsOf(results))}`)
}
{
  const input = 'hello'
  const results = detectContent(input)
  assertDetectionShape(results, 'base64-false-positive')
  const hit = findKind(results, 'base64')
  if (hit) {
    assert.ok(
      hit.confidence < 0.8,
      `plain word "hello" must not yield base64 confidence ≥ 0.8, got ${hit.confidence}`,
    )
  }
}

// ─── 5. 两行 CSV → csv ───────────────────────────────────────────────────────
{
  const input = 'a,b\n1,2'
  const results = detectContent(input)
  assertDetectionShape(results, 'csv')
  const hit = findKind(results, 'csv')
  assert.ok(hit, `two-line CSV should detect csv; got kinds=${JSON.stringify(kindsOf(results))}`)
}

// ─── 6. pretty JSON → json ───────────────────────────────────────────────────
{
  const input = '{"a":1}'
  const results = detectContent(input)
  assertDetectionShape(results, 'json')
  const hit = findKind(results, 'json')
  assert.ok(hit, `JSON object should detect json; got kinds=${JSON.stringify(kindsOf(results))}`)
}

// ─── 7. 普通中文 → 不得出现 jwt/base64/timestamp 且 confidence ≥ 0.85 ────────
{
  const input = '你好世界'
  const results = detectContent(input)
  assertDetectionShape(results, 'chinese-plain')
  for (const kind of ['jwt', 'base64', 'timestamp']) {
    const hit = findKind(results, kind)
    if (hit) {
      assert.ok(
        hit.confidence < 0.85,
        `plain Chinese must not yield ${kind} with confidence ≥ 0.85, got ${hit.confidence}`,
      )
    }
  }
}

// ─── 8. 空串 → unknown 单元素（约定写死，非空数组） ─────────────────────────
// Expectation locked for implementers:
// empty string returns exactly one detection: { kind: 'unknown', confidence: 1, normalized: '' }
// (not an empty array)
{
  const results = detectContent('')
  assertDetectionShape(results, 'empty')
  assert.equal(results.length, 1, 'empty string should return a single unknown detection')
  assert.equal(results[0].kind, 'unknown')
  assert.equal(results[0].confidence, 1)
  assert.equal(results[0].normalized, '')
}

console.log('content-kit detectContent checks passed')
