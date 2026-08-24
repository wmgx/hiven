#!/usr/bin/env node
/**
 * Contract: browser search results must visibly distinguish "already open"
 * tabs from "history" entries, and history must rank clearly below any open
 * tab — a closed page should never crowd out one you can actually switch to.
 *   src/plugins/web-open/browserProvider.ts — DesktopTargetProvider.list
 *
 * Before this contract, only the exact-URL identity hit among open tabs got
 * the "Browser tab / 浏览器标签页" pill; every other open tab fell through to
 * the generic protocol default (kind: 'tab' → "Browser / 浏览器"), which reads
 * the same as an unrelated tab, not "this is already open".
 *
 * Labels renamed 2026-08-22: "Open tab/已打开" → "Browser tab/浏览器标签页" and
 * "History/历史" → "Browser history/浏览器历史", to read clearly against the
 * host's own "Recently visited/最近访问" recents pill (persistableRecents.ts) —
 * users could not tell "已打开" (this plugin's open-tab pill) apart from
 * "最近文档" (the host's own recent-selection pill) at a glance.
 *
 * Run: node scripts/test-browser-search-open-vs-history-tag.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/plugins/web-open/browserProvider.ts', import.meta.url), 'utf8')

// Long history URLs usually differ at the tail (MR/PR id, redirect target).
// Showing the common prefix makes distinct rows look identical after ellipsis.
assert.match(src, /function compactHistoryUrl\(rawUrl: string\): string/)
assert.match(src, /subtitle: compactHistoryUrl\(item\.url\)/)

// ─── every open tab in query results gets the "Browser tab" pill ─────────────
{
  const start = src.indexOf('const tabs = ordered')
  const end = src.indexOf('const history = await desktopTargets.bridge.listHistory')
  assert.ok(start >= 0 && end > start, 'must find the tabs = ordered...map(...) block')
  const tabsBlock = src.slice(start, end)
  assert.match(
    tabsBlock,
    /kindLabelI18n:\s*\{\s*en:\s*'Browser tab',\s*zh:\s*'浏览器标签页'\s*\}/,
    'every open tab (not just the exact-URL identity hit) must show the "Browser tab / 浏览器标签页" pill',
  )
  assert.doesNotMatch(
    tabsBlock,
    /isOpenHit\s*\?\s*\{\s*scoreBias:\s*OPEN_TAB_FOCUS_BIAS,\s*kindLabelI18n/,
    'the "Open tab" pill must not be conditional on isOpenHit anymore — only the score boost stays conditional',
  )
  assert.match(
    tabsBlock,
    /isOpenHit\s*\?\s*\{\s*scoreBias:\s*OPEN_TAB_FOCUS_BIAS\s*\}\s*:\s*\{\s*\}/,
    'the identity hit must still get the extra focus-bias boost on top of the shared pill',
  )
}

// ─── history entries keep a distinct pill and a named, clearly-lower bias ────
{
  assert.match(
    src,
    /kindLabelI18n:\s*\{\s*en:\s*'Browser history',\s*zh:\s*'浏览器历史'\s*\}/,
    'history entries must show the "Browser history / 浏览器历史" pill',
  )
  assert.match(
    src,
    /scoreBias:\s*HISTORY_SCORE_BIAS/,
    'history bias must be a named constant, not an inline magic number',
  )
  assert.doesNotMatch(src, /scoreBias:\s*-80\b/, 'the old inline -80 history bias must be gone')

  const historyBias = Number(/HISTORY_SCORE_BIAS\s*=\s*(-?\d+)/.exec(src)?.[1])
  const focus = Number(/OPEN_TAB_FOCUS_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  const base = Number(/EMPTY_OPEN_BASE_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  const unranked = Number(/EMPTY_OPEN_UNRANKED_BIAS\s*=\s*(\d+)/.exec(src)?.[1])
  for (const [name, value] of [['OPEN_TAB_FOCUS_BIAS', focus], ['EMPTY_OPEN_BASE_BIAS', base], ['EMPTY_OPEN_UNRANKED_BIAS', unranked]]) {
    assert.ok(Number.isFinite(value), `${name} must be a named constant`)
  }
  assert.ok(Number.isFinite(historyBias) && historyBias < 0, 'HISTORY_SCORE_BIAS must be negative')
  assert.ok(
    historyBias < unranked && historyBias < base && historyBias < focus,
    `history must rank below every open-tab bias tier: ${historyBias} < ${unranked}, ${base}, ${focus}`,
  )
  // Demoted, but must stay within the same-tier bias budget (see toLauncherItem SCORE_BIAS_CAP).
  assert.ok(historyBias > -500, `HISTORY_SCORE_BIAS must stay within the ±500 same-tier bias cap, got ${historyBias}`)
  // Previously -80; must have been made more negative (lower priority), not just renamed.
  assert.ok(historyBias < -80, `HISTORY_SCORE_BIAS must be lower than the previous -80, got ${historyBias}`)
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
    major > 1 || (major === 1 && (minor > 9 || (minor === 9 && patch >= 1))),
    `web-open must be >= 1.9.1 for the open-vs-history tag/ranking change, got ${manifest.version}`,
  )
}

console.log('test-browser-search-open-vs-history-tag: ok')
