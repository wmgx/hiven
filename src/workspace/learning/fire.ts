/**
 * Self-learning · reverse fire (scenario D, D3b — impure).
 *
 * Makes an accepted url-template rule usable: when the launcher query is a value
 * of the rule's slot kind (a number for `.../merge_requests/{n}`), surface a host
 * launcher item that opens the filled URL on Enter — the "type the id, go straight
 * there" payoff, no command step.
 *
 * Rules are cached in memory (refreshed on accept/delete) so the per-keystroke
 * match is a cheap sync regex + small loop — no IndexedDB on the query hot path.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §11 (D) / §3.
 */

import { t, type Locale } from '../../i18n'
import { openExternalUrl } from '../effectRunner'
import { TelemetryEvents, trackBehavior } from '../telemetry'
import type { LauncherItem } from './../launcher/types'
import { queryAllRules, type LearnedRule } from './store'
import { fillTemplate, queryMatchesSlot, type UrlSlotKind } from './urlTemplate'

let cachedUrlRules: LearnedRule[] = []

/** Reload the in-memory url-template rule cache. Call on start + rule changes. */
export async function refreshLearnedUrlRules(): Promise<void> {
  try {
    const rules = await queryAllRules()
    cachedUrlRules = rules.filter((r) => r.transform.kind === 'url-template')
  } catch {
    cachedUrlRules = []
  }
}

function hostOf(template: string): string {
  const slash = template.indexOf('/')
  return slash === -1 ? template : template.slice(0, slash)
}

function buildOpenUrlItem(rule: LearnedRule, url: string, locale: Locale): LauncherItem {
  const host = rule.transform.kind === 'url-template' ? hostOf(rule.transform.template) : ''
  return {
    systemKey: `learned-url:${rule.clusterKey}`,
    kind: 'host',
    display: {
      title: t(locale, 'palette.learnFireOpen', { host }),
      subtitle: url,
      icon: 'Globe',
      kindLabel: t(locale, 'palette.learnFireKind'),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    // Learned direct answers are highly relevant when their slot matches — nudge up.
    staticPriority: 60,
    recordUsage: false,
    execute: async () => {
      await openExternalUrl(url)
      trackBehavior(TelemetryEvents.learningRuleFired, {
        slotKind: rule.transform.kind === 'url-template' ? rule.transform.slotKind : undefined,
      })
      return { ok: true as const }
    },
  }
}

/** Learned direct-answer items for a query (sync; cheap; empty when nothing matches). */
export function learnedUrlLauncherItems(query: string, locale: Locale): LauncherItem[] {
  const q = query.trim()
  if (!q || cachedUrlRules.length === 0) return []
  const items: LauncherItem[] = []
  for (const rule of cachedUrlRules) {
    if (rule.transform.kind !== 'url-template') continue
    if (!queryMatchesSlot(q, rule.transform.slotKind as UrlSlotKind)) continue
    const url = 'https://' + fillTemplate(rule.transform.template, q)
    items.push(buildOpenUrlItem(rule, url, locale))
  }
  return items
}
