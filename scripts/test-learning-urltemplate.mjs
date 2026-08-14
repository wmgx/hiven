#!/usr/bin/env node
/**
 * Contract: self-learning scenario D pure core.
 *   src/workspace/learning/urlTemplate.ts — templatizeUrl / induceUrlTemplates
 *
 * Must stay pure (no imports, no URL global) so the discovery core is testable
 * and boundary-safe. Verifies id-like segment templating, constant segments kept,
 * distinct-value threshold, and that slotless/one-value templates are not surfaced.
 *
 * Run: node scripts/test-learning-urltemplate.mjs
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
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const U = loadModule('src/workspace/learning/urlTemplate.ts')

// ─── hostnameOf: plain host string, no site semantics ─────────────────────────
{
  assert.equal(U.hostnameOf('https://code.byted.org/lark/merge_requests/1'), 'code.byted.org')
  assert.equal(U.hostnameOf('https://CODE.byted.org/x'), 'code.byted.org', 'lowercased')
  assert.equal(U.hostnameOf('http://grafana.byted.org/d/x'), 'grafana.byted.org', 'http scheme too')
  assert.equal(U.hostnameOf('not a url'), null, 'non-url → null')
  assert.equal(U.hostnameOf('chrome://extensions'), null, 'non-http scheme → null')
  assert.equal(U.hostnameOf(''), null, 'empty → null')
}

// ─── templatizeUrl: id-like path segments → typed slots ──────────────────────
{
  const r = U.templatizeUrl('https://code.byted.org/lark/backend/-/merge_requests/12345?tab=diffs#note')
  assert.ok(r, 'valid https url templatized')
  assert.equal(r.host, 'code.byted.org')
  assert.equal(r.template, 'code.byted.org/lark/backend/-/merge_requests/{n}', 'numeric id → {n}, query/fragment dropped')
  assert.equal(r.slots.join(','), '12345', 'concrete slot captured (for hashing, not stored)')
  assert.equal(r.slotKinds.join(','), 'n')

  // Constant path words are kept; only the id varies.
  const commit = U.templatizeUrl('https://code.byted.org/lark/x/commit/a1b2c3d4e5f6')
  assert.equal(commit.template, 'code.byted.org/lark/x/commit/{hex}', 'hex sha → {hex}')

  const uuid = U.templatizeUrl('https://svc.byted.org/trace/550e8400-e29b-41d4-a716-446655440000')
  assert.equal(uuid.template, 'svc.byted.org/trace/{uuid}', 'uuid → {uuid}')

  // Path id wins → query dropped (single-slot stability).
  const withQuery = U.templatizeUrl('https://code.byted.org/lark/-/merge_requests/12345?tab=diffs')
  assert.equal(withQuery.template, 'code.byted.org/lark/-/merge_requests/{n}', 'path id wins, query dropped')

  // No path id → an id-like query value becomes the slot (logid case, discovered
  // from browsing alone — no copy event needed); other params dropped.
  const queryId = U.templatizeUrl('https://argos.byted.org/trace?logid=20240813abcd1234&region=cn')
  assert.equal(queryId.template, 'argos.byted.org/trace?logid={hex}', 'query id templatized heuristically')
  assert.equal(queryId.slotKinds.join(','), 'hex')

  // No id-like segment anywhere → template has no slot.
  const homepage = U.templatizeUrl('https://code.byted.org/dashboard')
  assert.equal(homepage.template, 'code.byted.org/dashboard')
  assert.equal(homepage.slots.length, 0, 'no variable slot')

  const plainQuery = U.templatizeUrl('https://x.org/search?q=hello&page=on')
  assert.equal(plainQuery.slots.length, 0, 'non-id query values are not slots')

  // Non-http and junk rejected.
  assert.equal(U.templatizeUrl('ftp://x/y'), null, 'non-http rejected')
  assert.equal(U.templatizeUrl('not a url'), null, 'junk rejected')
}

// ─── induceUrlTemplates: distinct-value threshold ────────────────────────────
{
  const T = 'code.byted.org/lark/-/merge_requests/{n}'
  const mk = (slotHash, ts) => ({ template: T, slotHash, slotKind: 'n', ts })

  // 3 distinct MR numbers → discovered.
  const three = [mk('h1', 1), mk('h2', 2), mk('h3', 3)]
  const d = U.induceUrlTemplates(three)
  assert.equal(d.length, 1, 'three distinct values → discovered')
  assert.equal(d[0].template, T)
  assert.equal(d[0].host, 'code.byted.org')
  assert.equal(d[0].slotKind, 'n')
  assert.equal(d[0].distinctValues, 3)
  assert.equal(d[0].visits, 3)

  // Same page reloaded (1 distinct value, 5 visits) → NOT a template.
  const reloaded = [mk('same', 1), mk('same', 2), mk('same', 3), mk('same', 4), mk('same', 5)]
  assert.equal(U.induceUrlTemplates(reloaded).length, 0, 'one page reloaded → not discovered')

  // Slotless templates are never surfaced.
  const slotless = [
    { template: 'code.byted.org/dashboard', slotHash: 'a', ts: 1 },
    { template: 'code.byted.org/dashboard', slotHash: 'b', ts: 2 },
    { template: 'code.byted.org/dashboard', slotHash: 'c', ts: 3 },
  ]
  assert.equal(U.induceUrlTemplates(slotless).length, 0, 'no-slot template ignored')
}

// ─── ranking: most distinct values first ─────────────────────────────────────
{
  const navs = []
  const A = 'a.org/mr/{n}'
  const B = 'b.org/commit/{hex}'
  // A: 5 distinct, B: 3 distinct
  for (let i = 0; i < 5; i++) navs.push({ template: A, slotHash: `a${i}`, slotKind: 'n', ts: i })
  for (let i = 0; i < 3; i++) navs.push({ template: B, slotHash: `b${i}`, slotKind: 'hex', ts: 100 + i })
  const d = U.induceUrlTemplates(navs)
  assert.equal(d.length, 2, 'both meet threshold')
  assert.equal(d[0].template, A, 'more distinct values ranks first')
  assert.equal(d[1].template, B)

  // Raise threshold → only A survives.
  assert.equal(U.induceUrlTemplates(navs, { minDistinctValues: 4 }).length, 1, 'threshold honored')
}

// ─── slotKind inferred from template when record omits it ────────────────────
{
  const T = 'x.org/a/{hex}'
  const navs = [
    { template: T, slotHash: 'h1', ts: 1 },
    { template: T, slotHash: 'h2', ts: 2 },
    { template: T, slotHash: 'h3', ts: 3 },
  ]
  const d = U.induceUrlTemplates(navs)
  assert.equal(d.length, 1)
  assert.equal(d[0].slotKind, 'hex', 'slotKind inferred from template')
}

// ─── scenario A: templatizeUrlWithToken (copy-correlated slot) ───────────────
{
  // Token in the path → slot around that exact token.
  const p = U.templatizeUrlWithToken('https://code.byted.org/lark/-/merge_requests/9931', '9931')
  assert.ok(p, 'path token templatized')
  assert.equal(p.template, 'code.byted.org/lark/-/merge_requests/{n}')
  assert.equal(p.slotKinds.join(','), 'n')

  // Token in a query value → keep only that param (the logid case the heuristic drops).
  // (all-hex value → {hex}; other params dropped for clustering stability.)
  const q = U.templatizeUrlWithToken(
    'https://argos.byted.org/trace?logid=20240813abcd1234&region=cn',
    '20240813abcd1234',
  )
  assert.ok(q, 'query token templatized')
  assert.equal(q.template, 'argos.byted.org/trace?logid={hex}', 'only the token param kept, others dropped')

  // Opaque token (non-hex letters + digits, long) → slot kind id.
  const opaque = U.templatizeUrlWithToken('https://x.org/o/orderXYZ12345', 'orderXYZ12345')
  assert.ok(opaque, 'opaque token templatized')
  assert.equal(opaque.slotKinds.join(','), 'id')

  // Token not present, too short, or spaced → no template.
  assert.equal(U.templatizeUrlWithToken('https://x.org/a/1', '1'), null, 'too short')
  assert.equal(U.templatizeUrlWithToken('https://x.org/a/b', 'zzzz'), null, 'token absent')
  assert.equal(U.templatizeUrlWithToken('ftp://x/y', 'abcd1234'), null, 'non-http rejected')
}

// ─── reverse fire: queryMatchesSlot / fillTemplate ───────────────────────────
{
  assert.equal(U.queryMatchesSlot('12345', 'n'), true, 'digits match {n}')
  assert.equal(U.queryMatchesSlot('a1b2c3d4', 'hex'), true, 'hex string matches {hex}')
  assert.equal(U.queryMatchesSlot('550e8400-e29b-41d4-a716-446655440000', 'uuid'), true, 'uuid matches {uuid}')
  assert.equal(U.queryMatchesSlot('12345', 'hex'), false, 'a pure number is not a hex id')
  assert.equal(U.queryMatchesSlot('hello world', 'n'), false, 'prose does not match a slot')
  assert.equal(U.queryMatchesSlot('', 'n'), false, 'empty does not match')

  assert.equal(
    U.fillTemplate('code.byted.org/lark/-/merge_requests/{n}', '9931'),
    'code.byted.org/lark/-/merge_requests/9931',
    'slot filled with typed value',
  )
}

console.log('test-learning-urltemplate: ok')
