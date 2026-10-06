#!/usr/bin/env node
/**
 * Contract: browser history results must not duplicate an already-open tab,
 * and must rank by recency/frequency instead of a flat bias.
 *   src/plugins/web-open/browserProvider.ts — DesktopTargetProvider.list
 *
 * Before this contract, "browser tab" and "browser history" results for the
 * same URL both showed up in search (the tab from `listTargets`, the same
 * page again from `listHistory`) — visually duplicate rows differing only in
 * their kind pill. History also carried one flat scoreBias regardless of how
 * long ago the page was visited, so a page visited months ago ranked exactly
 * like one visited yesterday.
 *
 * Run: node scripts/test-browser-history-tab-dedup.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/plugins/web-open/browserProvider.ts', import.meta.url), 'utf8')

// ─── history entries already open as a tab must be filtered out ──────────────
{
  assert.match(
    src,
    /const openTabUrlKeys = new Set\(/,
    'must build a set of normalized URLs for every open tab that matched the query',
  )
  assert.match(
    src,
    /ordered\s*\n\s*\.map\(\(dto\) => normalizeUrlForMatch\(dto\.url,\s*\{\s*ignoreQuery:\s*true\s*\}\)\)/,
    'the open-tab URL set must be derived from `ordered` (every matched tab), not just the rendered slice',
  )
  assert.match(
    src,
    /openTabUrlKeys\.has\(key\)/,
    'history filtering must check membership in the open-tab URL set',
  )

  // The filter block itself: openTabUrlKeys check must come before the
  // history-internal openTabUrlKeys is what makes this cross-type (not just
  // self) de-dup.
  const filterBlock = src.slice(
    src.indexOf('.filter((item) => {\n          const key = normalizeUrlForMatch(item.url'),
    src.indexOf('.map((item) => ({\n          item,'),
  )
  assert.ok(filterBlock.length > 0, 'must find the history url-identity filter block')
  assert.match(filterBlock, /openTabUrlKeys\.has\(key\)/, 'filter block excludes URLs already open as a tab')
  assert.match(filterBlock, /seenHistoryUrlKeys\.has\(key\)/, 'filter block still de-dupes within history itself')
}

// ─── history de-dup must be query-blind (matches what's actually displayed) ──
{
  // The old bespoke `${url.origin}${url.pathname...}` key (query-blind) must
  // be gone — replaced by the canonical identity helper, but called with
  // ignoreQuery: true. Many pages (e.g. Meego/Lark issue links) attach a
  // per-visit or tracking query param that changes on every visit; the
  // precise default identity (query-sensitive, used for "focus this exact
  // open tab") would treat every such visit as a distinct page and never
  // collapse them — which is exactly the "these two rows look identical"
  // bug this exists to fix, since compactHistoryUrl never even displays the
  // query in the first place (see the assertion below).
  assert.doesNotMatch(
    src,
    /\$\{url\.origin\}\$\{url\.pathname\.replace/,
    'the bespoke query-blind history key must be replaced by normalizeUrlForMatch',
  )
  const historyBlock = src.slice(src.indexOf('const history = historySearchDays'))
  assert.match(
    historyBlock,
    /normalizeUrlForMatch\(item\.url,\s*\{\s*ignoreQuery:\s*true\s*\}\)/,
    'history de-dup keys must ignore the query string, matching what compactHistoryUrl displays',
  )
  // compactHistoryUrl itself omitting query/hash is covered by
  // test-browser-search-open-vs-history-tag.mjs; not re-asserted here.
}

// ─── history ranking decays with recency (and frequency, when known) ─────────
{
  const historyBlock = src.slice(
    src.indexOf('const history = historySearchDays'),
    src.indexOf('return [...tabs, ...historyTargets]'),
  )
  assert.match(
    historyBlock,
    /visitFrecency\(item\.visits, now\)/,
    'exact per-visit timestamps must be used for history ranking when the extension provides them',
  )
  assert.match(
    historyBlock,
    /visitFrecencyFromSummary\(item\.visitCount \?\? 0, item\.lastVisitTime, now\)/,
    'falls back to the visitCount/lastVisitTime summary approximation otherwise',
  )
  assert.match(
    historyBlock,
    /\.sort\(\(a, b\) => b\.score - a\.score\)/,
    'history entries must be sorted by decayed score before the display slice is taken, ' +
      'so older/less-visited pages are the ones dropped once the limit is hit',
  )
  assert.match(
    historyBlock,
    /scoreBias:\s*HISTORY_SCORE_BIAS\s*-\s*index\s*\*\s*HISTORY_RANK_STEP_BIAS/,
    'each history entry\'s bias must step down by rank, so older/rarer visits score strictly lower ' +
      'than fresher ones instead of sharing one flat bias',
  )

  const step = Number(/HISTORY_RANK_STEP_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  const base = Number(/HISTORY_SCORE_BIAS\s*=\s*(-?\d+)/.exec(src)?.[1])
  const limit = Number(/QUERY_HISTORY_LIMIT\s*=\s*(\d+)/.exec(src)?.[1])
  const focus = Number(/OPEN_TAB_FOCUS_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  assert.ok(Number.isFinite(step) && step > 0, 'HISTORY_RANK_STEP_BIAS must be a positive named constant')
  // Even the last-ranked history entry at the display limit must stay well
  // clear of open-tab territory (0 for a plain tab, up to OPEN_TAB_FOCUS_BIAS
  // for the identity hit) — recency ranking must never let history outrank
  // something the user can actually switch to right now.
  const worstCaseBias = base - (limit - 1) * step
  assert.ok(
    worstCaseBias < 0 && base > worstCaseBias,
    `history bias must stay negative and strictly decrease across the display limit, got worst-case ${worstCaseBias}`,
  )
  assert.ok(
    base - 0 * step < focus,
    'even the freshest history entry must rank below an open tab',
  )
}

// ─── plugin version was bumped for the behavior change ───────────────────────
{
  const manifest = JSON.parse(
    readFileSync(new URL('../src/plugins/web-open/manifest.json', import.meta.url), 'utf8'),
  )
  const index = JSON.parse(
    readFileSync(new URL('../src/builtin-plugins/index.json', import.meta.url), 'utf8'),
  )
  const pkg = index.packages.find((p) => p.pluginId === 'web-open')
  assert.equal(
    pkg.version,
    manifest.version,
    'builtin release manifest must match the plugin manifest, or users keep the old build',
  )
  const [major, minor, patch] = manifest.version.split('.').map(Number)
  assert.ok(
    major > 1 || (major === 1 && (minor > 9 || (minor === 9 && patch >= 7))),
    `web-open must be >= 1.9.7 for the tab/history de-dup + recency-ranking change, got ${manifest.version}`,
  )
}

console.log('test-browser-history-tab-dedup: ok')
