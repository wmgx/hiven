/**
 * Self-learning · reverse fire (scenarios D + B — impure).
 *
 * Makes an accepted rule usable as a direct answer:
 *  - url-template (D): the query is a value of the slot kind → open the filled URL.
 *  - chain (B): the query matches the learned input shape → run the tool chain and
 *    show/copy the collapsed result, in one step instead of several.
 *
 * Rules are cached in memory (refreshed on accept/delete) so the per-keystroke
 * match is a cheap sync check — no IndexedDB on the query hot path.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §11 (B/D) / §3.
 */

import { t, type Locale } from '../../i18n'
import { openExternalUrl } from '../effectRunner'
import { TelemetryEvents, trackBehavior } from '../telemetry'
import type { LauncherItem } from './../launcher/types'
import { findHistoryRecall, type HistoryRecallHit } from './clipboardBrowserLink'
import { extractFeatures, featureSignature, isPlausibleToken, normalizeToken } from './features'
import { FIRE_STRENGTH_BONUS, firePriority } from './frecency'
import { getCurrentActiveHost, getRecentHistoryForRecall } from './navigationSensor'
import { isNewlyLearned } from './proposals'
import { runLearnedChain } from './registryRunners'
import { bumpRuleStrength, pruneForgottenRules, queryAllRules, type LearnedRule } from './store'
import { fillTemplate, queryMatchesSlot, type UrlSlotKind } from './urlTemplate'

/**
 * Priority for a scenario-L3 history recall ("you already saw this page").
 * Below the learned baseline (45) — this wasn't taught, it's a standing
 * capability — but above the flat plugin-builtin tier (30): an exact bounded
 * token match against real browsing history is stronger evidence than a
 * generic plugin's self-declared answer.
 */
const HISTORY_RECALL_PRIORITY = 35
/** At most this many recall hits per query — direct answers must stay scannable. */
const HISTORY_RECALL_LIMIT = 1

/**
 * Fire-time disambiguation: when a token's shape matches multiple learned
 * templates (e.g. the same hex shape learned on two different sites), boost
 * the one whose destination host matches where the user currently is. Plain
 * string equality on host names — no site/plugin semantics, works for any
 * desktop-bridge source that reports a URL.
 */
const ACTIVE_HOST_FIRE_BOOST = 40

export function activeHostFireBoost(ruleHost: string, activeHost: string | null): number {
  return Boolean(ruleHost) && activeHost === ruleHost ? ACTIVE_HOST_FIRE_BOOST : 0
}

let cachedUrlRules: LearnedRule[] = []
let cachedChainRules: LearnedRule[] = []

/**
 * Reload the in-memory learned-rule caches (forgetting decayed rules first).
 * Call on start + rule changes.
 */
export async function refreshLearnedUrlRules(): Promise<void> {
  try {
    await pruneForgottenRules()
    const rules = await queryAllRules()
    cachedUrlRules = rules.filter((r) => r.transform.kind === 'url-template')
    cachedChainRules = rules.filter((r) => r.transform.kind === 'chain')
  } catch {
    cachedUrlRules = []
    cachedChainRules = []
  }
}

async function feedback(rule: LearnedRule): Promise<void> {
  // Frecency: used → stronger + fresher; refresh so the new weight ranks the next fire.
  await bumpRuleStrength(rule.clusterKey, FIRE_STRENGTH_BONUS)
  void refreshLearnedUrlRules()
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // best-effort
    }
  }
}

function hostOf(template: string): string {
  const slash = template.indexOf('/')
  return slash === -1 ? template : template.slice(0, slash)
}

function truncate(text: string, max = 80): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= max ? single : single.slice(0, max) + '…'
}

// ─── url-template fire (scenario D) ────────────────────────────────────────────

function buildOpenUrlItem(rule: LearnedRule, url: string, locale: Locale): LauncherItem {
  const host = rule.transform.kind === 'url-template' ? hostOf(rule.transform.template) : ''
  const hostBoost = activeHostFireBoost(host, getCurrentActiveHost())
  const boosted = hostBoost > 0
  return {
    systemKey: `learned-url:${rule.clusterKey}`,
    kind: 'dynamic',
    display: {
      title: t(locale, 'palette.learnFireOpen', { host }),
      subtitle: url,
      // Boosted (fire-time host match) gets a distinct icon + label so the
      // disambiguation is visible, not just felt via ranking — same shape
      // learned on two sites otherwise looks identical either way.
      icon: boosted ? 'MapPin' : 'Globe',
      // A silently-learned rule announces itself while it's still new — this is
      // what replaces asking up front. It stops after a few fires (see
      // isNewlyLearned) so an established rule doesn't nag forever.
      kindLabel: isNewlyLearned(rule)
        ? t(locale, 'palette.learnFireKindNew')
        : t(locale, boosted ? 'palette.learnFireKindHere' : 'palette.learnFireKind'),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    // First-class answer: exempt from the query-present filter (the title is the
    // destination, not the typed token) and its priority is honored whatever the
    // kind. The nudge scales with frecency so rules you keep using rank higher,
    // plus a fire-time boost when this rule's destination is where you are right
    // now (disambiguates same-shape tokens learned on different sites).
    directAnswer: { priority: firePriority(rule) + hostBoost, origin: 'learned' },
    recordUsage: false,
    execute: async () => {
      await openExternalUrl(url)
      await feedback(rule)
      trackBehavior(TelemetryEvents.learningRuleFired, {
        transformKind: 'url-template',
        slotKind: rule.transform.kind === 'url-template' ? rule.transform.slotKind : undefined,
        // Data for future ranking-weight learning (see host-plugin-genericity
        // discussion): did the fire-time host boost apply to the fired rule?
        hostBoosted: hostBoost > 0,
      })
      return { ok: true as const }
    },
  }
}

// ─── chain fire (scenario B) ───────────────────────────────────────────────────

function buildChainItem(rule: LearnedRule, result: string, locale: Locale): LauncherItem {
  const steps = rule.transform.kind === 'chain' ? rule.transform.toolIds.length : 0
  return {
    systemKey: `learned-chain:${rule.clusterKey}`,
    kind: 'dynamic',
    display: {
      // The title is the collapsed RESULT — which is exactly why this needs to be
      // a first-class direct answer rather than a text-matched list item.
      title: truncate(result),
      subtitle: t(locale, 'palette.learnFireChain', { steps: String(steps) }),
      icon: 'Wand2',
      kindLabel: t(locale, 'palette.learnFireKind'),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    directAnswer: { priority: firePriority(rule), origin: 'learned' },
    recordUsage: false,
    execute: async () => {
      await copyToClipboard(result)
      await feedback(rule)
      trackBehavior(TelemetryEvents.learningRuleFired, { transformKind: 'chain', steps })
      return { ok: true as const }
    },
  }
}

/**
 * "Not this one" — offered right below a rule that was learned silently, for its
 * first few fires only.
 *
 * The undo lives HERE, at the moment the rule actually does something, rather
 * than in an up-front proposal: the user sees a concrete result and decides
 * about that, instead of being asked to rule on an abstract pattern. It is a
 * plain launcher item (not a keyboard shortcut) so it's discoverable, and so it
 * stays out of the tuned arrow-key model.
 */
function buildUndoItem(rule: LearnedRule, locale: Locale, priority: number): LauncherItem {
  return {
    systemKey: `learned-undo:${rule.clusterKey}`,
    kind: 'dynamic',
    display: {
      title: t(locale, 'palette.learnUndoTitle'),
      subtitle: t(locale, 'palette.learnUndoSubtitle'),
      icon: 'Trash2',
      kindLabel: t(locale, 'palette.learnFireKindNew'),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    // Just below its own rule, so it never outranks the answer it annotates.
    directAnswer: { priority: Math.max(0, priority - 1), origin: 'learned' },
    recordUsage: false,
    execute: async () => {
      const { undoLearnedRule } = await import('./learningController')
      await undoLearnedRule(rule)
      return { ok: true as const }
    },
  }
}

// ─── history recall fire (scenario L3) ─────────────────────────────────────────

function buildHistoryRecallItem(hit: HistoryRecallHit, locale: Locale): LauncherItem {
  return {
    systemKey: `learned-recall:${hit.url}`,
    kind: 'dynamic',
    display: {
      title: hit.title,
      subtitle: hit.url,
      icon: 'History',
      kindLabel: t(locale, 'palette.learnFireKindRecall'),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    // First-class answer for the same reason as buildOpenUrlItem: the title is
    // the destination (a page you already saw), not the typed token.
    directAnswer: { priority: HISTORY_RECALL_PRIORITY, origin: 'builtin' },
    recordUsage: false,
    execute: async () => {
      await openExternalUrl(hit.url)
      trackBehavior(TelemetryEvents.learningRuleFired, { transformKind: 'history-recall' })
      return { ok: true as const }
    },
  }
}

/** Learned direct-answer items for a query (sync; cheap; empty when nothing matches). */
export function learnedLauncherItems(query: string, locale: Locale): LauncherItem[] {
  const q = query.trim()
  if (!q) return []
  const items: LauncherItem[] = []

  if (isPlausibleToken(q)) {
    const history = getRecentHistoryForRecall()
    if (history.length > 0) {
      const hits = findHistoryRecall(normalizeToken(q), history, HISTORY_RECALL_LIMIT)
      for (const hit of hits) items.push(buildHistoryRecallItem(hit, locale))
    }
  }

  for (const rule of cachedUrlRules) {
    if (rule.transform.kind !== 'url-template') continue
    if (!queryMatchesSlot(q, rule.transform.slotKind as UrlSlotKind)) continue
    const url = 'https://' + fillTemplate(rule.transform.template, q)
    const item = buildOpenUrlItem(rule, url, locale)
    items.push(item)
    if (isNewlyLearned(rule)) {
      items.push(buildUndoItem(rule, locale, item.directAnswer?.priority ?? 0))
    }
  }

  if (cachedChainRules.length > 0) {
    const sig = featureSignature(extractFeatures(q))
    for (const rule of cachedChainRules) {
      if (rule.transform.kind !== 'chain') continue
      if (rule.matcher.kind !== 'feature-sig' || rule.matcher.sig !== sig) continue
      const result = runLearnedChain(rule.transform.toolIds, q)
      if (result) items.push(buildChainItem(rule, result, locale))
    }
  }

  return items
}
