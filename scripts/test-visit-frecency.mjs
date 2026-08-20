#!/usr/bin/env node
/**
 * Contract: two-scale visit frecency.
 *   src/workspace/launcher/visitFrecency.ts
 *
 * One decay rate cannot rank both kinds of thing a person keeps returning to:
 *
 *   A. long-lived habit   — an AI site opened a few times a week for months
 *   B. short burst        — the PRD / MR / design doc for the feature you're
 *                           shipping this week, dead the moment it ships
 *
 * A slow half-life keeps B on the list for weeks after it went cold; a fast one
 * forgets A over a quiet stretch. So: score on two time scales and take the
 * better — but gate the slow (habit) scale on how long the visits actually
 * SPAN, so three days of frantic clicking can never masquerade as a habit.
 *
 * Generic on purpose: no site lists, no url patterns, no domain knowledge —
 * just visit timestamps.
 *
 * Run: node scripts/test-visit-frecency.mjs
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

const V = loadModule('src/workspace/launcher/visitFrecency.ts')

const DAY = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000

/** `count` visits ending `endDaysAgo` days ago, spread back over `spanDays`. */
function visits(count, spanDays, endDaysAgo) {
  const end = now - endDaysAgo * DAY
  if (count === 1) return [end]
  const step = (spanDays * DAY) / (count - 1)
  return Array.from({ length: count }, (_, i) => end - i * step)
}

// The two scenarios, as described.
const habitSite = visits(60, 90, 1)      // AI site: 60 visits over 3 months, used yesterday
const liveBurst = visits(25, 3, 0)       // this week's PRD: 25 hits in 3 days, still hot
const deadBurst = visits(25, 3, 20)      // same PRD, shipped 20 days ago

// ─── 1. a live burst outranks a steady habit (you're working on it NOW) ──────
{
  const burst = V.visitFrecency(liveBurst, now)
  const habit = V.visitFrecency(habitSite, now)
  assert.ok(
    burst > habit,
    `an actively-hammered page should outrank a background habit: ${burst.toFixed(2)} > ${habit.toFixed(2)}`,
  )
}

// ─── 2. once the burst dies, the habit outranks it ───────────────────────────
// This is the whole point: the shipped PRD must fall off, the AI site must not.
{
  const dead = V.visitFrecency(deadBurst, now)
  const habit = V.visitFrecency(habitSite, now)
  assert.ok(
    habit > dead,
    `a shipped burst must fall below a real habit: habit ${habit.toFixed(2)} > dead ${dead.toFixed(2)}`,
  )
  assert.ok(
    dead < V.visitFrecency(liveBurst, now) * 0.2,
    'a dead burst retains only a small fraction of its live score',
  )
}

// ─── 3. span gating: identical visit counts, different life stories ──────────
// Same 25 visits, same "20 days since last touch" — but one was a 3-day sprint
// and the other was spread over 4 months. Only the latter is a habit.
{
  const sprint = V.visitFrecency(visits(25, 3, 20), now)
  const sustained = V.visitFrecency(visits(25, 120, 20), now)
  assert.ok(
    sustained > sprint,
    `same count + same recency, longer span must score higher: ${sustained.toFixed(2)} > ${sprint.toFixed(2)}`,
  )
}

// ─── 4. more visits is better, all else equal ────────────────────────────────
{
  assert.ok(
    V.visitFrecency(visits(40, 30, 1), now) > V.visitFrecency(visits(5, 30, 1), now),
    'frequency still matters',
  )
}

// ─── 5. more recent is better, all else equal ────────────────────────────────
{
  assert.ok(
    V.visitFrecency(visits(20, 30, 1), now) > V.visitFrecency(visits(20, 30, 25), now),
    'recency still matters',
  )
}

// ─── 6. degenerate input is safe ─────────────────────────────────────────────
{
  assert.equal(V.visitFrecency([], now), 0, 'no visits → 0')
  assert.ok(V.visitFrecency([now], now) > 0, 'a single visit scores above zero')
  assert.ok(Number.isFinite(V.visitFrecency([now + 5 * DAY], now)), 'future timestamps do not explode')
  assert.ok(V.visitFrecency([now + 5 * DAY], now) >= 0, 'future timestamps never go negative')
}

// ─── 7. classification is exposed for UI grouping / debugging ────────────────
{
  assert.equal(V.classifyVisitPattern(habitSite, now), 'habit', 'long span + recent → habit')
  assert.equal(V.classifyVisitPattern(liveBurst, now), 'burst', 'short span + hot → burst')
  assert.equal(V.classifyVisitPattern(deadBurst, now), 'stale', 'short span + cold → stale')
  assert.equal(V.classifyVisitPattern([], now), 'stale', 'nothing → stale')
}

// ─── 8. ranking a realistic mixed set puts the right things on top ───────────
{
  const entries = [
    { id: 'ai-site', visits: habitSite },
    { id: 'current-prd', visits: liveBurst },
    { id: 'shipped-prd', visits: deadBurst },
    { id: 'read-once', visits: visits(1, 0, 4) },
    { id: 'old-habit-gone-quiet', visits: visits(50, 120, 70) },
  ]
  const ranked = V.rankByVisitFrecency(entries, now).map((e) => e.id)

  assert.equal(ranked[0], 'current-prd', 'what you are working on right now leads')
  assert.equal(ranked[1], 'ai-site', 'the daily habit is second')
  assert.ok(
    ranked.indexOf('shipped-prd') > ranked.indexOf('ai-site'),
    'the shipped PRD sits below the habit',
  )
  assert.equal(ranked.at(-1), 'shipped-prd', 'a shipped one-week doc sinks to the bottom')
  // A months-long habit that went quiet still outranks a 3-day doc that went
  // quiet, even though it has been cold for far longer. Span is evidence of how
  // much something mattered, and habits recur — a shipped PRD does not.
  assert.ok(
    ranked.indexOf('old-habit-gone-quiet') < ranked.indexOf('shipped-prd'),
    'a long-lived habit gone quiet still beats a short-lived doc gone quiet',
  )
}

// ─── 9. summary scoring (browser-history cold start) ─────────────────────────
// Chrome gives only visitCount + lastVisitTime, so span is unavailable. The
// approximation must still get the obvious cases right.
{
  const s = (count, daysAgo) => V.visitFrecencyFromSummary(count, now - daysAgo * DAY, now)

  assert.ok(s(500, 0.5) > s(500, 30), 'same volume, more recent wins')
  assert.ok(s(500, 1) > s(5, 1), 'same recency, more visits wins')
  assert.ok(
    s(30, 0.2) > s(400, 40),
    'a page hammered today beats a big pile of visits from six weeks ago',
  )
  assert.ok(
    s(400, 20) > s(3, 20),
    'with equal staleness, the long-established page survives better',
  )

  // Log damping: volume has diminishing returns.
  const ratioSmall = s(50, 30) / s(5, 30)
  const ratioLarge = s(500, 30) / s(50, 30)
  assert.ok(
    ratioLarge < ratioSmall,
    `visit volume must have diminishing returns: ${ratioLarge.toFixed(2)} < ${ratioSmall.toFixed(2)}`,
  )

  assert.equal(V.visitFrecencyFromSummary(0, now, now), 0, 'no visits → 0')
  assert.equal(V.visitFrecencyFromSummary(10, null, now), 0, 'no timestamp → 0')
  assert.equal(V.visitFrecencyFromSummary(10, undefined, now), 0, 'missing timestamp → 0')
  assert.ok(Number.isFinite(s(10, -5)), 'future lastVisitTime does not explode')
}

console.log('test-visit-frecency: ok')
