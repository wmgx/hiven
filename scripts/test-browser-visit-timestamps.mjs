#!/usr/bin/env node
/**
 * Contract: per-visit timestamps flow extension → bridge → ranking.
 *   src/plugins/web-open/extension/background.js  (chrome.history.getVisits)
 *   src-tauri/src/desktop_bridge.rs               (BridgeHistoryItem.visits)
 *   src/plugins/web-open/browserProvider.ts       (exact over approximate)
 *
 * visitCount + lastVisitTime cannot separate "25 visits over three frantic days"
 * from "25 visits spread over four months" — that span signal is what tells a
 * habit from a finished sprint. getVisits supplies the real distribution.
 *
 * The backward-compat assertions matter as much as the feature: a user running
 * the previous extension build must keep working, so `visits` is optional at
 * every hop and the ranking falls back to the summary.
 *
 * Run: node scripts/test-browser-visit-timestamps.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const background = read('src/plugins/web-open/extension/background.js')
const bridgeRs = read('src-tauri/src/desktop_bridge.rs')
const provider = read('src/plugins/web-open/browserProvider.ts')
const dto = read('src/workspace/desktopControl/bridgeTargets.ts')

// ─── extension collects and reports per-visit timestamps ─────────────────────
{
  assert.match(background, /chrome\.history\.getVisits/, 'extension calls getVisits')
  assert.match(background, /visits:\s*visitsByUrl\.get\(item\.url\)/, 'visits ride along on each history item')
  assert.match(
    background,
    /if \(!chrome\.history\?\.getVisits\) return new Map\(\)/,
    'absent API degrades to no timestamps rather than throwing',
  )
  assert.match(background, /catch\s*\{/, 'a single unreadable URL cannot fail the whole push')
}

// ─── bounded work: one call per URL, so it must be capped on both axes ───────
{
  const urls = Number(/VISITS_DETAIL_MAX_URLS\s*=\s*(\d+)/.exec(background)?.[1])
  const perUrl = Number(/VISITS_PER_URL_MAX\s*=\s*(\d+)/.exec(background)?.[1])
  assert.ok(Number.isFinite(urls) && urls > 0 && urls <= 100, `URL fan-out must be bounded, got ${urls}`)
  assert.ok(Number.isFinite(perUrl) && perUrl > 0 && perUrl <= 200, `per-URL timestamps must be bounded, got ${perUrl}`)

  const historyMax = Number(/HISTORY_MAX\s*=\s*(\d+)/.exec(background)?.[1])
  assert.ok(urls <= historyMax, 'enrichment cannot exceed the history page count itself')

  // The cap must keep the NEWEST timestamps, or recency is destroyed by truncation.
  assert.match(
    background,
    /times\.slice\(-VISITS_PER_URL_MAX\)/,
    'truncation keeps the most recent visits (slice from the end)',
  )
  assert.match(background, /times\.sort\(/, 'timestamps are ordered before truncation')
}

// ─── BACKWARD COMPAT: an older extension must still work ─────────────────────
{
  // Rust: a missing field must deserialize, not reject the whole POST.
  const field = /#\[serde\(default\)\]\s*\n\s*pub visits: Option<Vec<f64>>/.exec(bridgeRs)
  assert.ok(
    field,
    'BridgeHistoryItem.visits must be Option + #[serde(default)] so old extensions keep posting',
  )

  // TS DTO: optional and nullable.
  assert.match(dto, /visits\?: number\[\] \| null/, 'history DTO treats visits as optional')

  // Ranking: exact when available, summary otherwise.
  assert.match(provider, /visitFrecency\(visits, now\)/, 'uses exact timestamps when present')
  assert.match(
    provider,
    /visitFrecencyFromSummary\(stats\.visitCount, stats\.lastVisitTime, now\)/,
    'falls back to the summary approximation',
  )
  assert.match(
    provider,
    /stats\.visits\.length > 0 \? stats\.visits : undefined/,
    'the fallback is chosen by presence of real timestamps',
  )
}

// ─── extension version bumped (users must reload it to get the new behavior) ──
{
  const manifest = JSON.parse(read('src/plugins/web-open/extension/manifest.json'))
  const [major, minor] = manifest.version.split('.').map(Number)
  assert.ok(
    major > 0 || minor >= 3,
    `extension version must be bumped for the getVisits change, got ${manifest.version}`,
  )
  assert.ok(
    manifest.permissions.includes('history'),
    'getVisits needs the history permission (already granted, no new prompt)',
  )
}

console.log('test-browser-visit-timestamps: ok')
