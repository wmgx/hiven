#!/usr/bin/env node
/**
 * Soft nav de-dup: title near-duplicate + capability tier demotion.
 * Host must not hard-filter Chromium windows by product name.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const policy = readFileSync(join(root, 'src/workspace/desktopTargets/browserWindowPolicy.ts'), 'utf8')
const host = readFileSync(join(root, 'src/workspace/launcher/hostProvider.ts'), 'utf8')
const ranking = readFileSync(join(root, 'src/workspace/launcher/ranking.ts'), 'utf8')

// Host no longer applies product-hard filter on merge
assert.doesNotMatch(host, /filterWindowItemsWhenBrowserTabsPresent\(/)
assert.doesNotMatch(host, /microsoft edge|Chromium window/i)

// Soft demotion lives in ranking via generic helper
assert.match(ranking, /navNearDuplicateDemotion/)
assert.match(ranking, /scoreLauncherItem\(ctx, item, candidates\)/)

// Policy is capability + title based, not Edge/Chrome hard hide
assert.match(policy, /navNearDuplicateDemotion/)
assert.match(policy, /NAV_NEAR_DUP_DEMOTION/)
assert.match(policy, /desktop-browser-tabs/)
assert.match(policy, /desktop-windows/)
assert.match(policy, /navTitlesNearDuplicate/)
// Hard filter is deprecated no-op
assert.match(policy, /@deprecated Hard filter removed/)

// Pure logic checks (mirror exports)
function normalizeNavTitle(title) {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[\u2013\u2014|·•]+/g, ' ').replace(/\s+/g, ' ').trim()
}
function navTitlesNearDuplicate(a, b) {
  const na = normalizeNavTitle(a)
  const nb = normalizeNavTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (shorter.length < 4) return false
  if (longer.includes(shorter)) return true
  let i = 0
  while (i < shorter.length && shorter[i] === longer[i]) i += 1
  return i >= Math.min(12, Math.floor(shorter.length * 0.7))
}
function navigationSurfaceTier(item) {
  const caps = item.requiredCapabilities ?? []
  if (caps.includes('desktop-browser-tabs')) return 30
  if (caps.includes('desktop-windows')) return 20
  return 0
}
function navNearDuplicateDemotion(item, peers) {
  const tier = navigationSurfaceTier(item)
  if (tier <= 0) return 0
  const title = item.display.title ?? ''
  for (const peer of peers) {
    if (peer.systemKey === item.systemKey) continue
    if (navigationSurfaceTier(peer) <= tier) continue
    if (!navTitlesNearDuplicate(title, peer.display.title ?? '')) continue
    return 700
  }
  return 0
}

const windowItem = {
  systemKey: 'host.window:focus:native:1',
  requiredCapabilities: ['desktop-windows'],
  display: { title: 'RFC design notes' },
}
const tabItem = {
  systemKey: 'browser.chromium:tab:9',
  requiredCapabilities: ['desktop-browser-tabs'],
  display: { title: 'RFC design notes' },
}
const otherWindow = {
  systemKey: 'host.window:focus:native:2',
  requiredCapabilities: ['desktop-windows'],
  display: { title: 'Meeting notes' },
}
const peers = [windowItem, tabItem, otherWindow]

assert.equal(navNearDuplicateDemotion(windowItem, peers), 700, 'window demoted when tab has same title')
assert.equal(navNearDuplicateDemotion(tabItem, peers), 0, 'tab not demoted')
assert.equal(navNearDuplicateDemotion(otherWindow, peers), 0, 'unrelated window not demoted')
assert.ok(navTitlesNearDuplicate('Docs — work', 'Docs'))
assert.ok(!navTitlesNearDuplicate('ab', 'abcdef'))

console.log('soft browser window/tab dedup checks passed')
