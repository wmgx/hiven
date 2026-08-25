export const CONTENT_SOURCE_STORES = [
  'clipboard-history',
  'snippets',
  'quick-editor-history',
  'sticky-query-draft',
  'saved-actions',
] as const

export const NO_CONTENT_SINKS = [
  'telemetry',
  'usage-journal',
  'experience-journal',
] as const

const SAFE_TELEMETRY_STRING_KEYS = new Set([
  'actionId',
  'behaviorType',
  'commandId',
  'event',
  'itemKind',
  'kind',
  'openId',
  'phase',
  'pluginId',
  'reason',
  'source',
  'status',
  'surfaceId',
  'systemKey',
  'targetKind',
  'via',
])

export function isSafeExperienceIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value)
}

/** Keep telemetry shape-only even when a caller accidentally supplies content. */
export function sanitizeNoContentDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined
  return Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
    if (typeof value === 'string') {
      if (!SAFE_TELEMETRY_STRING_KEYS.has(key)) return []
      if (['actionId', 'commandId', 'openId', 'pluginId', 'systemKey'].includes(key) && !isSafeExperienceIdentifier(value)) return []
    }
    if (Array.isArray(value) || (value && typeof value === 'object')) return []
    return [[key, value]]
  }))
}
