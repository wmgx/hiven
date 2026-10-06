/**
 * Single contribution → ResolvedLauncherItem field normalizer.
 *
 * Authoring inputs (`launcher.items`, `tools` via adapter, `dynamicItems`)
 * must share the same resolved field set. This module is the only place that
 * copies contribution protocol fields onto a LauncherItem draft.
 *
 * Protocol fields (must stay in sync across all three authoring forms):
 *   display, behavior, surfaces, inputPolicy,
 *   params, defaultParams, requireParamSelection, executeWithParams,
 *   accepts, match, textMatch, suggest, recordUsage, directAnswer, execute
 */

import type {
  LauncherItem,
  LauncherItemContribution,
  LauncherItemContributionKind,
  SystemLauncherItemKey,
} from './types'
import type { ContributionSource } from '../pluginTypes'
import { sanitizeSurfaces } from './identity'
import { resolvePluginSettingsSource } from './pluginSource'

/**
 * Ranking nudge given to any plugin-declared direct answer. Deliberately below
 * the learned-rule baseline (see learning/frecency.ts firePriority, from 45), so
 * a rule the user actually taught ranks above a generic built-in answer — while
 * both still appear (learned never suppresses builtin).
 */
const PLUGIN_DIRECT_ANSWER_PRIORITY = 30

/**
 * Shared across all contribution-authoring forms (launcher.items, tools,
 * dynamicItems) so a plugin-declared `directAnswer: true` always resolves to the
 * same host-assigned priority no matter which form declared it.
 */
export function toDirectAnswer(flag: boolean | undefined): LauncherItem['directAnswer'] {
  return flag ? { priority: PLUGIN_DIRECT_ANSWER_PRIORITY, origin: 'builtin' as const } : undefined
}

export type NormalizeContributionOptions = {
  systemKey: SystemLauncherItemKey
  kind: LauncherItemContributionKind
  pluginId: string
  source: ContributionSource
}

/**
 * Map a plugin-authored contribution onto the shared LauncherItem field set.
 * Does not apply productProvider / host-only ranking metadata.
 */
export function normalizeContribution(
  contribution: LauncherItemContribution,
  options: NormalizeContributionOptions,
): LauncherItem {
  const settingsSource = resolvePluginSettingsSource(options.pluginId, options.source)
  const defaultParams = { ...(contribution.defaultParams ?? {}) }
  for (const param of contribution.params ?? []) {
    if (defaultParams[param.key] === undefined && param.default !== undefined) {
      defaultParams[param.key] = param.default
    }
  }

  const hasParams = (contribution.params?.length ?? 0) > 0
  // Answer semantics are plugin-declared; the ranking nudge is host-assigned so
  // plugins can't outbid each other (or the user's own learned rules) for the
  // top answer slot. Anything truthy means "I am an answer", nothing more.
  const directAnswer = toDirectAnswer(contribution.directAnswer)
  const recordUsage = options.kind === 'dynamic'
    ? (contribution.recordUsage === true ? true : undefined)
    : contribution.recordUsage

  return {
    systemKey: options.systemKey,
    kind: options.kind,
    pluginId: options.pluginId,
    source: settingsSource,
    display: contribution.display,
    behavior: contribution.behavior ?? { type: 'perform' },
    surfaces: sanitizeSurfaces(contribution.surfaces),
    inputPolicy: contribution.inputPolicy,
    params: contribution.params,
    defaultParams: Object.keys(defaultParams).length > 0 ? defaultParams : contribution.defaultParams,
    requireParamSelection: contribution.requireParamSelection,
    // Protocol: content intent + optional match filter (see intentEngine / ranking).
    accepts: contribution.accepts,
    match: contribution.match,
    textMatch: contribution.textMatch,
    suggest: contribution.suggest,
    directAnswer,
    recordUsage,
    execute: contribution.execute,
    // Params protocol: same for static and dynamic. executeWithParams only when schema exists
    // (or author supplied a custom handler without params array — rare).
    executeWithParams: hasParams || contribution.executeWithParams
      ? contribution.executeWithParams
      : undefined,
  }
}
