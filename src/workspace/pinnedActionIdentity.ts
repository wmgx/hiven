type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish | undefined }

function normalize(value: unknown): Jsonish {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    )
  }
  return String(value)
}

export function pinnedParamsFingerprint(params?: Record<string, unknown>): string {
  return JSON.stringify(normalize(params ?? {}))
}

export function samePinnedParams(left?: Record<string, unknown>, right?: Record<string, unknown>): boolean {
  return pinnedParamsFingerprint(left) === pinnedParamsFingerprint(right)
}

export type PinnedPluginCommandIdentity = {
  kind?: string
  actionId: string
  pluginId?: string
  isDev?: boolean
  params?: Record<string, unknown>
}

export function samePinnedPluginCommandIdentity(
  pinned: PinnedPluginCommandIdentity,
  command: PinnedPluginCommandIdentity,
): boolean {
  return pinned.kind === 'plugin-command' &&
    command.kind === 'plugin-command' &&
    pinned.actionId === command.actionId &&
    pinned.pluginId === command.pluginId &&
    !!pinned.isDev === !!command.isDev &&
    samePinnedParams(pinned.params, command.params)
}
