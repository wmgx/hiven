/**
 * Content recommendations driven by tool `accepts` + optional match filter.
 *
 * Aligns with intentEngine / ranking:
 *   accepts coarse filter → optional match fine filter (empty/null/throw = skip).
 */

import type { ContentDetection, ContentKind } from '../../kits/content'
import { isIntentEligible } from '../../workspace/launcher/intentEngine'
import type { ContentAccepts, IntentHit, IntentMatchContext } from '../../workspace/launcher/intentTypes'
import type { RecommendedAction } from './actionRecommendation'

export type AcceptsToolDescriptor = {
  pluginId: string
  toolId: string
  title: string
  titleZh?: string
  icon?: string
  provider?: string
  accepts?: ContentAccepts
  match?: (ctx: IntentMatchContext) => IntentHit[] | null
}

export type RecommendFromToolAcceptsParams = {
  kind: string
  contentText?: string
  detections?: Array<{
    kind: string
    confidence?: number
    normalized?: string
    captures?: Record<string, string>
  }>
  tools: readonly AcceptsToolDescriptor[]
  query?: string
  locale?: string
  context?: Record<string, unknown>
  foregroundApp?: string
}

function buildDetections(params: RecommendFromToolAcceptsParams): ContentDetection[] {
  const contentText = params.contentText ?? ''
  if (params.detections && params.detections.length > 0) {
    return params.detections.map((d) => ({
      kind: d.kind as ContentKind,
      confidence: d.confidence ?? 1,
      normalized: d.normalized ?? contentText,
      ...(d.captures ? { captures: d.captures } : {}),
    }))
  }
  return [
    {
      kind: params.kind as ContentKind,
      confidence: 1,
      normalized: contentText,
    },
  ]
}

/**
 * Recommend actions for tools whose declarative `accepts` (+ optional match) pass.
 * - Tools without accepts are skipped
 * - toolId is de-duplicated (first hit wins)
 * - match is a filter: empty/null/throw/timeout → skip (does not surface on accepts alone)
 */
export function recommendActionsFromToolAccepts(
  params: RecommendFromToolAcceptsParams,
): RecommendedAction[] {
  const detections = buildDetections(params)
  const ctx: IntentMatchContext = {
    query: params.query ?? '',
    locale: params.locale ?? 'en',
    context: params.context ?? {},
    detections,
    contentText: params.contentText,
    foregroundApp: params.foregroundApp,
  }

  const seenToolIds = new Set<string>()
  const actions: RecommendedAction[] = []

  for (const tool of params.tools) {
    if (tool.accepts == null) continue
    if (seenToolIds.has(tool.toolId)) continue
    if (!isIntentEligible(tool.accepts, tool.match, ctx)) continue

    seenToolIds.add(tool.toolId)
    actions.push({
      id: tool.toolId,
      title: tool.title,
      titleZh: tool.titleZh ?? tool.title,
      icon: tool.icon,
      pluginId: tool.pluginId,
      provider: tool.provider ?? tool.pluginId,
      defaultOutput: 'copy',
      alternativeOutputs: [],
    })
  }

  return actions
}
