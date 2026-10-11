import { visitFrecency } from './visitFrecency'

export const RETENTION_MS = 90 * 86400000
export const MAX_EVENTS = 1000
export type SuccessEvent = { actionKey: string; originAppId: string | null; at: number; session: string }
export type Suggestion = { actionKey: string; reason: 'app' | 'recent' }
// Only static protocol identifiers. Dynamic IDs can encode URLs, paths or text.
export function isSuggestionActionKey(key: string): boolean {
  return /^(?:plugin:[A-Za-z0-9._-]+:(?:launcher|tool):[A-Za-z0-9._-]+|plugin-surface:(?:builtin|installed|dev):[A-Za-z0-9._-]+:[A-Za-z0-9._-]+|host:(?:action|view):[A-Za-z0-9._-]+)$/.test(key)
}
export function validOrigin(value: unknown): value is string {
  return typeof value === 'string' && /^(?:mac-bundle|x11-class):[A-Za-z0-9._-]{1,160}$/.test(value)
}
export function retainEvents(events: readonly SuccessEvent[], now: number): SuccessEvent[] {
  return events.filter(e => isSuggestionActionKey(e.actionKey) && (e.originAppId === null || validOrigin(e.originAppId)) &&
    Number.isFinite(e.at) && e.at <= now && e.at > now - RETENTION_MS && /^[A-Za-z0-9-]{1,80}$/.test(e.session))
    .slice(-MAX_EVENTS).map(e => ({ actionKey: e.actionKey, originAppId: e.originAppId, at: e.at, session: e.session }))
}
/** Independent top-three selection; never combines intent/search scores with history. */
export function selectContextSuggestions(options: {
  events: readonly SuccessEvent[]; originAppId: string | null; availableKeys: readonly string[];
  excludedKeys?: readonly string[]; now: number
}): Suggestion[] {
  const available = new Set(options.availableKeys.filter(isSuggestionActionKey))
  for (const key of options.excludedKeys ?? []) available.delete(key)
  const groups = new Map<string, SuccessEvent[]>()
  for (const event of retainEvents(options.events, options.now)) {
    if (!available.has(event.actionKey)) continue
    const group = groups.get(event.actionKey) ?? []
    group.push(event); groups.set(event.actionKey, group)
  }
  const scored = [...groups].map(([actionKey, events]) => {
    const bySession = new Map<string, number>()
    for (const e of events) if (options.originAppId && e.originAppId === options.originAppId) {
      bySession.set(e.session, Math.max(e.at, bySession.get(e.session) ?? 0))
    }
    // Three independent opens are the minimum evidence for an app explanation.
    return { actionKey, app: bySession.size >= 3,
      score: visitFrecency([...bySession.values()], options.now), last: Math.max(...events.map(e => e.at)) }
  })
  scored.sort((a, b) => Number(b.app) - Number(a.app) ||
    (a.app && b.app ? b.score - a.score : 0) || b.last - a.last || a.actionKey.localeCompare(b.actionKey))
  return scored.slice(0, 3).map(e => ({ actionKey: e.actionKey, reason: e.app ? 'app' : 'recent' }))
}
