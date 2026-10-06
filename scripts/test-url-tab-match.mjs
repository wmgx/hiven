#!/usr/bin/env node
/**
 * Contract: browser-tabs already-open URL matcher.
 *   src/plugins/web-open/urlTabMatch.ts — normalizeUrlForMatch / findOpenTabForUrl
 *
 * Pure page-identity matching: tolerant of trailing slash / #fragment / http↔https,
 * strict on host / path / query. Proves "copied link is already open → focus it"
 * without the running app.
 *
 * Run: node scripts/test-url-tab-match.mjs
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
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, URL }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const { normalizeUrlForMatch, findOpenTabForUrl } = loadModule('src/plugins/web-open/urlTabMatch.ts')

// ─── normalizeUrlForMatch — page identity ────────────────────────────────────
{
  const base = normalizeUrlForMatch('https://code.byted.org/foo/merge_requests/9931')
  assert.ok(base, 'valid https url normalizes')

  // Differences that do NOT change page identity → same key.
  assert.equal(normalizeUrlForMatch('https://code.byted.org/foo/merge_requests/9931/'), base, 'trailing slash ignored')
  assert.equal(normalizeUrlForMatch('https://code.byted.org/foo/merge_requests/9931#notes'), base, '#fragment ignored')
  assert.equal(normalizeUrlForMatch('http://code.byted.org/foo/merge_requests/9931'), base, 'http↔https folded')
  assert.equal(normalizeUrlForMatch('https://CODE.byted.org/foo/merge_requests/9931'), base, 'host case-insensitive')

  // Root path collapses so "/" and "" match.
  assert.equal(
    normalizeUrlForMatch('https://example.com/'),
    normalizeUrlForMatch('https://example.com'),
    'root slash collapses',
  )

  // Differences that DO change page identity → different keys.
  assert.notEqual(normalizeUrlForMatch('https://code.byted.org/foo/merge_requests/9932'), base, 'different id differs')
  assert.notEqual(
    normalizeUrlForMatch('https://code.byted.org/foo/merge_requests/9931?tab=commits'),
    base,
    'query changes identity',
  )
  assert.notEqual(normalizeUrlForMatch('https://other.byted.org/foo/merge_requests/9931'), base, 'host differs')

  // Non-http(s) inputs are not matchable.
  assert.equal(normalizeUrlForMatch('chrome://extensions'), null, 'chrome:// not matchable')
  assert.equal(normalizeUrlForMatch('not a url'), null, 'garbage not matchable')
  assert.equal(normalizeUrlForMatch(''), null, 'empty not matchable')
  assert.equal(normalizeUrlForMatch(null), null, 'null not matchable')
}

// ─── normalizeUrlForMatch({ ignoreQuery: true }) — coarse "same page" grouping ─
{
  // Used to declutter history/recents rows, which never display the query
  // (see compactHistoryUrl) — so two visits differing only by a tracking or
  // per-visit query param must collapse to one key, unlike the default.
  const withoutQuery = normalizeUrlForMatch('https://example.com/foo/bar', { ignoreQuery: true })
  assert.ok(withoutQuery, 'valid https url normalizes with ignoreQuery')
  assert.equal(
    normalizeUrlForMatch('https://example.com/foo/bar?session=abc123', { ignoreQuery: true }),
    withoutQuery,
    'a query-only difference collapses to the same key when ignoreQuery is set',
  )
  assert.equal(
    normalizeUrlForMatch('https://example.com/foo/bar?session=xyz789', { ignoreQuery: true }),
    withoutQuery,
    'a DIFFERENT query-only difference also collapses to the same key',
  )
  // Default behavior (no options / ignoreQuery: false) is unchanged — query
  // still distinguishes pages, since that precision is required for focusing
  // an exact open tab.
  assert.notEqual(
    normalizeUrlForMatch('https://example.com/foo/bar?session=abc123'),
    withoutQuery,
    'without ignoreQuery, a query difference still changes identity',
  )
  // A path difference still changes identity even with ignoreQuery — only
  // the query is dropped, not the whole page identity.
  assert.notEqual(
    normalizeUrlForMatch('https://example.com/foo/other', { ignoreQuery: true }),
    withoutQuery,
    'ignoreQuery does not blur a real path difference',
  )
}

// ─── findOpenTabForUrl — resolve to the focusable tab ────────────────────────
{
  const tabs = [
    { id: '11', url: 'https://grafana.byted.org/d/abc/home', windowId: '1' },
    { id: '22', url: 'https://code.byted.org/foo/merge_requests/9931', windowId: '2' },
    { id: '33', url: 'chrome://newtab', windowId: '2' },
    { id: '44', url: undefined, windowId: '2' },
  ]

  // Copied link is already open (with a trailing slash + fragment) → focus tab 22.
  // Note: hit is created inside the vm realm — compare by field, not deepEqual.
  const hit = findOpenTabForUrl('http://code.byted.org/foo/merge_requests/9931/#notes', tabs)
  assert.ok(hit, 'already-open link resolves to a tab')
  assert.equal(hit.id, '22', 'resolves to the right tab id (scheme/slash/# tolerant)')
  assert.equal(hit.windowId, '2', 'carries the tab windowId for focus')

  // Not open → no focus target (host would fall through to web-open "open").
  assert.equal(findOpenTabForUrl('https://code.byted.org/foo/merge_requests/9999', tabs), null, 'unopened link → null')

  // A different query on an otherwise-open page is a different page → no match.
  assert.equal(
    findOpenTabForUrl('https://grafana.byted.org/d/abc/home?var=prod', tabs),
    null,
    'same page + different query → not the same open tab',
  )

  // Non-http copied content never matches.
  assert.equal(findOpenTabForUrl('chrome://newtab', tabs), null, 'protected url never focuses a tab')
  assert.equal(findOpenTabForUrl('just text', tabs), null, 'non-url never focuses a tab')
}

console.log('test-url-tab-match: ok')
