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
 *   accepts, match, textMatch, suggest, recordUsage, execute
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
    recordUsage,
    legacyUsageKeys: options.kind === 'dynamic' ? undefined : [contribution.id],
    execute: contribution.execute,
    // Params protocol: same for static and dynamic. executeWithParams only when schema exists
    // (or author supplied a custom handler without params array — rare).
    executeWithParams: hasParams || contribution.executeWithParams
      ? contribution.executeWithParams
      : undefined,
  }
}
