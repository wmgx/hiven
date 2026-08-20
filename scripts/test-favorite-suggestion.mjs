#!/usr/bin/env node
/**
 * Contract: suggesting what's worth keeping (favorite suggestion).
 *   src/workspace/launcher/favoriteSuggestion.ts
 *
 * "You keep opening this — want to keep it?" is only a good question about
 * things that stay useful. The doc you hammered all week ships on Friday and is
 * dead weight in a favorites list forever after; the site you've opened weekly
 * for months is exactly what belongs there.
 *
 * So suggestion is gated on the visit PATTERN, not the visit count: habits
 * qualify, bursts never do — however hot the burst is right now.
 *
 * Run: node scripts/test-favorite-suggestion.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
function loadModule(path, globals = {}) {
  const out = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  // Strip the relative import and inject the dependency directly.
  const stripped = out.replace(/const \w+ = require\("\.\/visitFrecency"\);?/g, '')
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(stripped, sandbox)
  return sandbox.module.exports
}

const V = loadModule('src/workspace/launcher/visitFrecency.ts')
const F = loadModule('src/workspace/launcher/favoriteSuggestion.ts', { visitFrecency_1: V })

const DAY = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000

function visits(count, spanDays, endDaysAgo) {
  const end = now - endDaysAgo * DAY
  if (count === 1) return [end]
  const step = (spanDays * DAY) / (count - 1)
  return Array.from({ length: count }, (_, i) => end - i * step)
}

const habitSite = visits(60, 90, 1)   // opened for months, used yesterday
const liveBurst = visits(25, 3, 0)    // this week's PRD, still hot
const deadBurst = visits(25, 3, 20)   // same PRD, shipped
const casual = visits(3, 20, 2)       // opened a handful of times

// ─── 1. a long-running habit is worth keeping ────────────────────────────────
{
  assert.equal(
    F.shouldSuggestFavorite({ visits: habitSite, isFavorite: false }, now),
    true,
    'months of regular use → worth suggesting',
  )
}

// ─── 2. a burst is NOT, however hot ──────────────────────────────────────────
// The core judgement: intensity today says nothing about value next month.
{
  assert.equal(
    F.shouldSuggestFavorite({ visits: liveBurst, isFavorite: false }, now),
    false,
    'a hot three-day sprint must not be suggested — it will be dead weight next week',
  )
  assert.equal(
    F.shouldSuggestFavorite({ visits: deadBurst, isFavorite: false }, now),
    false,
    'a shipped sprint even more so',
  )
}

// ─── 3. already favorited → never suggested again ────────────────────────────
{
  assert.equal(
    F.shouldSuggestFavorite({ visits: habitSite, isFavorite: true }, now),
    false,
    'no nagging about something already kept',
  )
}

// ─── 4. thin evidence is not a habit ─────────────────────────────────────────
{
  assert.equal(
    F.shouldSuggestFavorite({ visits: casual, isFavorite: false }, now),
    false,
    'three visits is not a habit',
  )
  assert.equal(F.shouldSuggestFavorite({ visits: [], isFavorite: false }, now), false, 'no visits → no')
  assert.equal(F.shouldSuggestFavorite({ visits: [now], isFavorite: false }, now), false, 'one visit → no')
}

// ─── 5. an abandoned habit is not resurrected as a suggestion ────────────────
{
  const abandoned = visits(50, 120, 200)
  assert.equal(
    F.shouldSuggestFavorite({ visits: abandoned, isFavorite: false }, now),
    false,
    'a habit dropped half a year ago is not worth keeping now',
  )
}

// ─── 6. ranking + bounded output ─────────────────────────────────────────────
{
  const entries = [
    { key: 'ai-site', visits: habitSite, isFavorite: false },
    { key: 'current-prd', visits: liveBurst, isFavorite: false },
    { key: 'shipped-prd', visits: deadBurst, isFavorite: false },
    { key: 'already-kept', visits: habitSite, isFavorite: true },
    { key: 'docs-site', visits: visits(40, 60, 3), isFavorite: false },
  ]
  const suggested = F.suggestFavorites(entries, now)
  const keys = [...suggested].map((s) => s.key)

  assert.ok(keys.includes('ai-site'), 'the habit is suggested')
  assert.ok(keys.includes('docs-site'), 'a second habit is suggested')
  assert.equal(keys.includes('current-prd'), false, 'bursts excluded')
  assert.equal(keys.includes('shipped-prd'), false, 'dead bursts excluded')
  assert.equal(keys.includes('already-kept'), false, 'existing favorites excluded')

  // Strongest first.
  assert.equal(keys[0], 'ai-site', 'the strongest habit leads')

  // Bounded — a wall of suggestions is its own kind of nagging.
  const many = Array.from({ length: 30 }, (_, i) => ({
    key: `site-${i}`,
    visits: habitSite,
    isFavorite: false,
  }))
  assert.ok(F.suggestFavorites(many, now).length <= 3, 'suggestions are capped')
}

console.log('test-favorite-suggestion: ok')
