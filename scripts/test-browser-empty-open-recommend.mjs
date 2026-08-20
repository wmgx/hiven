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

// ─── ranking uses visit frecency from the host SDK, not tab order ────────────
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

// ─── bounded output, and never outranking explicit intent ────────────────────
{
  const limit = /EMPTY_OPEN_TAB_LIMIT\s*=\s*(\d+)/.exec(src)
  assert.ok(limit, 'empty-open output is bounded by a named constant')
  assert.ok(
    Number(limit[1]) > 0 && Number(limit[1]) <= 10,
    `empty-open tab count must stay small, got ${limit[1]}`,
  )

  const base = Number(/EMPTY_OPEN_BASE_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  const focus = Number(/OPEN_TAB_FOCUS_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  assert.ok(Number.isFinite(base) && Number.isFinite(focus), 'both biases are named constants')
  assert.ok(
    base < focus,
    `a passive recommendation must not outrank an explicit copied-link intent: ${base} < ${focus}`,
  )

  const unranked = Number(/EMPTY_OPEN_UNRANKED_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  assert.ok(
    unranked < base,
    'tabs with no known history rank below tabs with real visit stats',
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
