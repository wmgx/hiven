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
import { extractFeatures, featureSignature } from './features'
import { FIRE_STRENGTH_BONUS, firePriority } from './frecency'
import { runLearnedChain } from './registryRunners'
import { bumpRuleStrength, pruneForgottenRules, queryAllRules, type LearnedRule } from './store'
import { fillTemplate, queryMatchesSlot, type UrlSlotKind } from './urlTemplate'

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

function buildOpenUrlItem(rule: LearnedRule, url: string, query: string, locale: Locale): LauncherItem {
  const host = rule.transform.kind === 'url-template' ? hostOf(rule.transform.template) : ''
  return {
    systemKey: `learned-url:${rule.clusterKey}`,
    kind: 'host',
    display: {
      title: t(locale, 'palette.learnFireOpen', { host }),
      subtitle: url,
      icon: 'Globe',
      kindLabel: t(locale, 'palette.learnFireKind'),
      // The triggering query is what surfaces this item — make it match itself so
      // the query-present ranking filter (host items must match) keeps it.
      aliases: [query],
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    // Learned direct answers are highly relevant when their slot matches — the
    // nudge scales with frecency so rules you keep using rank higher.
    staticPriority: firePriority(rule),
    recordUsage: false,
    execute: async () => {
      await openExternalUrl(url)
      await feedback(rule)
      trackBehavior(TelemetryEvents.learningRuleFired, {
        transformKind: 'url-template',
        slotKind: rule.transform.kind === 'url-template' ? rule.transform.slotKind : undefined,
      })
      return { ok: true as const }
    },
  }
}

// ─── chain fire (scenario B) ───────────────────────────────────────────────────

function buildChainItem(rule: LearnedRule, result: string, query: string, locale: Locale): LauncherItem {
  const steps = rule.transform.kind === 'chain' ? rule.transform.toolIds.length : 0
  return {
    systemKey: `learned-chain:${rule.clusterKey}`,
    kind: 'host',
    display: {
      title: truncate(result),
      subtitle: t(locale, 'palette.learnFireChain', { steps: String(steps) }),
      icon: 'Wand2',
      kindLabel: t(locale, 'palette.learnFireKind'),
      // Match the triggering query so the query-present host-item filter keeps it.
      aliases: [query],
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    staticPriority: firePriority(rule),
    recordUsage: false,
    execute: async () => {
      await copyToClipboard(result)
      await feedback(rule)
      trackBehavior(TelemetryEvents.learningRuleFired, { transformKind: 'chain', steps })
      return { ok: true as const }
    },
  }
}

/** Learned direct-answer items for a query (sync; cheap; empty when nothing matches). */
export function learnedLauncherItems(query: string, locale: Locale): LauncherItem[] {
  const q = query.trim()
  if (!q) return []
  const items: LauncherItem[] = []

  for (const rule of cachedUrlRules) {
    if (rule.transform.kind !== 'url-template') continue
    if (!queryMatchesSlot(q, rule.transform.slotKind as UrlSlotKind)) continue
    const url = 'https://' + fillTemplate(rule.transform.template, q)
    items.push(buildOpenUrlItem(rule, url, q, locale))
  }

  if (cachedChainRules.length > 0) {
    const sig = featureSignature(extractFeatures(q))
    for (const rule of cachedChainRules) {
      if (rule.transform.kind !== 'chain') continue
      if (rule.matcher.kind !== 'feature-sig' || rule.matcher.sig !== sig) continue
      const result = runLearnedChain(rule.transform.toolIds, q)
      if (result) items.push(buildChainItem(rule, result, q, locale))
    }
  }

  return items
}
