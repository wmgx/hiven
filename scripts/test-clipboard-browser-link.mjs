#!/usr/bin/env node
/**
 * Contract: scenario L — clipboard ↔ browser linkage core.
 *   src/workspace/learning/clipboardBrowserLink.ts
 *     induceSourceScopedTemplates — L1/L2 source-scoped copy→navigate
 *     findHistoryRecall / urlContainsToken — L3 clipboard→history recall
 *
 * Pure (no imports); templatize + classify are injected so the core never
 * duplicates urlTemplate/features. Proves the DISAMBIGUATION (same token shape
 * from different source sites → different destinations) and bounded recall,
 * without the running app.
 *
 * Run: node scripts/test-clipboard-browser-link.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
function loadModule(path) {
  const out = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, URL, decodeURIComponent }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const { induceSourceScopedTemplates, findHistoryRecall, urlContainsToken } = loadModule(
  'src/workspace/learning/clipboardBrowserLink.ts',
)

// ─── injected stubs (mimic the real urlTemplate/features just enough) ─────────
const classifyShape = (t) => (/^[0-9a-f]{7,40}$/i.test(t) ? 'hex' : /^\d+$/.test(t) ? 'number' : 'id')

// Templatize by replacing the token in the path with a {slotKind} slot.
const templatize = (url, token) => {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!parsed.pathname.includes(token)) return null
  const slotKind = classifyShape(token)
  const template = `${parsed.host}${parsed.pathname}`.replace(token, `{${slotKind}}`)
  return { template, slots: [token], slotKinds: [slotKind], host: parsed.host }
}

// ─── L1/L2 · source-scoped disambiguation ─────────────────────────────────────
{
  // Same hex SHAPE, copied on two different sites, lands on two different dests.
  const pairs = [
    { token: 'a1b2c3d', sourceHost: 'grafana.byted.org', visitedUrl: 'https://grafana.byted.org/d/a1b2c3d/panel' },
    { token: 'e4f5a6b', sourceHost: 'grafana.byted.org', visitedUrl: 'https://grafana.byted.org/d/e4f5a6b/panel' },
    { token: 'deadbee', sourceHost: 'code.byted.org', visitedUrl: 'https://code.byted.org/repo/commit/deadbee' },
    { token: 'cafef00', sourceHost: 'code.byted.org', visitedUrl: 'https://code.byted.org/repo/commit/cafef00' },
  ]
  const out = induceSourceScopedTemplates(pairs, templatize, classifyShape, 2)
  assert.equal(out.length, 2, 'same shape, two source hosts → two distinct candidates (disambiguation)')

  const byHost = Object.fromEntries(out.map((c) => [c.sourceHost, c]))
  assert.ok(byHost['grafana.byted.org'], 'grafana route learned')
  assert.ok(byHost['code.byted.org'], 'code route learned')
  assert.equal(byHost['grafana.byted.org'].template, 'grafana.byted.org/d/{hex}/panel', 'grafana dest template')
  assert.equal(byHost['code.byted.org'].template, 'code.byted.org/repo/commit/{hex}', 'code dest template')
  assert.equal(byHost['grafana.byted.org'].tokenShape, 'hex')
  assert.equal(byHost['code.byted.org'].support, 2, 'two distinct tokens → support 2')
}

// ─── support threshold: a one-off route is not yet a rule ──────────────────────
{
  const pairs = [
    { token: 'a1b2c3d', sourceHost: 'code.byted.org', visitedUrl: 'https://code.byted.org/repo/commit/a1b2c3d' },
  ]
  assert.equal(induceSourceScopedTemplates(pairs, templatize, classifyShape, 2).length, 0, 'single sample → no candidate')

  // Same token seen twice is still ONE distinct token → support 1, not 2.
  const dupe = [
    { token: 'a1b2c3d', sourceHost: 'code.byted.org', visitedUrl: 'https://code.byted.org/repo/commit/a1b2c3d' },
    { token: 'a1b2c3d', sourceHost: 'code.byted.org', visitedUrl: 'https://code.byted.org/repo/commit/a1b2c3d' },
  ]
  assert.equal(induceSourceScopedTemplates(dupe, templatize, classifyShape, 2).length, 0, 'repeated same token → still support 1')
}

// ─── L3 · clipboard → history recall (bounded) ────────────────────────────────
{
  assert.equal(urlContainsToken('https://x.byted.org/issues/4213', '4213'), true, 'whole path segment matches')
  assert.equal(urlContainsToken('https://x.byted.org/log?logid=abcd1234', 'abcd1234'), true, 'query value matches')
  assert.equal(urlContainsToken('https://x.byted.org/issues/42130', '4213'), false, 'substring of a segment does NOT match (bounded)')
  assert.equal(urlContainsToken('not a url', '4213'), false, 'non-url → no match')

  const history = [
    { url: 'https://meego.byted.org/story/4213', title: 'Story 4213' },
    { url: 'https://x.byted.org/issues/9999', title: 'Other' },
    { url: 'https://logs.byted.org/view?logid=4213', title: 'Log 4213' },
    { url: 'https://meego.byted.org/story/4213', title: 'Story 4213 dup' },
  ]
  const hits = findHistoryRecall('4213', history)
  assert.equal(hits.length, 2, 'recalls both pages carrying the token, deduped by url')
  assert.equal(hits[0].url, 'https://meego.byted.org/story/4213', 'first match order preserved')
  assert.equal(findHistoryRecall('nope', history).length, 0, 'token not in any history → no recall')
  assert.equal(findHistoryRecall('', history).length, 0, 'empty token → no recall')
}

console.log('test-clipboard-browser-link: ok')
