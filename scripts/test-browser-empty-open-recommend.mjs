#!/usr/bin/env node
/**
 * Contract: browser tabs on empty open, ranked by visit frecency.
 *   src/plugins/web-open/browserProvider.ts — buildEmptyOpenTargets
 *
 * Empty open used to return zero tabs. It now recommends the open pages worth
 * returning to, ranked by how the user actually uses them (frequency + recency
 * from browser history, joined onto open tabs by URL).
 *
 * Source-level contract: the provider runs inside the plugin host and talks to
 * the desktop bridge, so this asserts the wiring and boundary rules rather than
 * booting the bridge. The ranking maths itself is covered by
 * test-visit-frecency.mjs.
 *
 * Run: node scripts/test-browser-empty-open-recommend.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/plugins/web-open/browserProvider.ts', import.meta.url), 'utf8')
const host = readFileSync(new URL('../src/workspace/launcher/hostProvider.ts', import.meta.url), 'utf8')
const collect = readFileSync(
  new URL('../src/workspace/desktopTargets/collectBridgeLauncherItems.ts', import.meta.url),
  'utf8',
)

// ─── empty open must produce recommendations, not an empty list ──────────────
{
  assert.doesNotMatch(
    src,
    /if \(!q\) return \[\]/,
    'empty open must no longer short-circuit to zero tabs',
  )
  assert.match(
    src,
    /if \(!q\) return buildEmptyOpenTargets\(\)/,
    'empty open delegates to the recommendation builder',
  )
}

// ─── the real host path must call the provider on empty open ─────────────────
{
  assert.doesNotMatch(
    collect,
    /if\s*\(!ctx\.query\.trim\(\)\)\s*return\s*\[\]/,
    'bridge collection must not discard empty queries before the provider sees them',
  )
  assert.match(
    host,
    /if\s*\(!q\)[\s\S]*Promise\.all\(\[[\s\S]*bridgePromise[\s\S]*\.\.\.bridgeItems/,
    'empty-open host collection must merge browser recommendations',
  )
}

// ─── ranking and admission use visit behavior, not tab order or a quota ──────
{
  assert.match(
    src,
    /visitFrecencyFromSummary/,
    'recommendations are ranked by visit frecency',
  )
  assert.match(
    src,
    /from '@hiven\/plugin'/,
    'ranking helper comes through the plugin SDK',
  )
  assert.match(
    src,
    /classifyVisitPattern/,
    'empty-open admission distinguishes active habits/bursts from stale pages',
  )
  assert.match(
    src,
    /evidenceCount\s*<\s*EMPTY_OPEN_MIN_VISITS/,
    'one incidental visit is not enough evidence for a passive recommendation',
  )
  // Boundary: a plugin must never deep-import host internals.
  assert.doesNotMatch(
    src,
    /from '\.\.\/\.\.\/workspace/,
    'plugin must not deep-import workspace (use @hiven/plugin)',
  )
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/kits/, 'plugin must not deep-import kits')
}

// ─── history is joined onto tabs by normalized URL ───────────────────────────
{
  assert.match(src, /listHistory\(CHROMIUM_SOURCE_ID\)/, 'reads browser history for visit stats')
  assert.match(src, /listTargets\(CHROMIUM_SOURCE_ID\)/, 'reads open tabs')
  assert.match(
    src,
    /normalizeUrlForMatch/,
    'tabs and history are matched on normalized URLs, not raw strings',
  )
  assert.match(
    src,
    /Promise\.all\(\[/,
    'tabs and history are fetched concurrently (empty open is latency-critical)',
  )
}

// ─── behavior-adaptive output, and never outranking explicit intent ─────────
{
  assert.doesNotMatch(
    src,
    /EMPTY_OPEN_TAB_LIMIT|scored\.slice\(/,
    'empty-open recommendations must not use a fixed tab quota',
  )

  const base = Number(/EMPTY_OPEN_MAX_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  const focus = Number(/OPEN_TAB_FOCUS_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  assert.ok(Number.isFinite(base) && Number.isFinite(focus), 'both biases are named constants')
  assert.ok(
    base < focus,
    `a passive recommendation must not outrank an explicit copied-link intent: ${base} < ${focus}`,
  )
  assert.doesNotMatch(
    src,
    /EMPTY_OPEN_UNRANKED_BIAS/,
    'unknown tabs are searchable but must not be promoted as empty-open recommendations',
  )
  assert.match(
    src,
    /scoreBias:\s*Math\.min\(EMPTY_OPEN_MAX_BIAS, score\)/,
    'actual browser frecency must affect cross-source ranking',
  )
  assert.match(
    src,
    /\.slice\(0, QUERY_TAB_LIMIT\)/,
    'explicit tab search remains bounded independently from empty-open recommendations',
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
  const [major, minor] = manifest.version.split('.').map(Number)
  assert.ok(
    major > 1 || (major === 1 && minor >= 6),
    `web-open must be >= 1.6.0 for the empty-open recommendation, got ${manifest.version}`,
  )
}

console.log('test-browser-empty-open-recommend: ok')
