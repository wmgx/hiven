import { useSyncExternalStore } from 'react'
import { isSuggestionActionKey, retainEvents, validOrigin, type SuccessEvent } from './contextSuggestions'

const KEY = 'hiven-context-suggestions-v1'
type Metrics = { session: string; at: number; selected: boolean; executed: boolean }
type State = { enabled: boolean; epoch: string; events: SuccessEvent[]; metrics: Metrics[]; storageError?: boolean }
const empty = (): State => ({ enabled: false, epoch: crypto.randomUUID(), events: [], metrics: [] })
const listeners = new Set<() => void>()
// Settings changes must reach sibling windows even when persistence is unavailable.
const channel = typeof window.BroadcastChannel === 'undefined' ? null : new window.BroadcastChannel(KEY)
function read(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw.epoch !== 'string') return empty()
    return { enabled: raw.enabled === true, epoch: raw.epoch,
      events: retainEvents(Array.isArray(raw.events) ? raw.events : [], Date.now()),
      metrics: (Array.isArray(raw.metrics) ? raw.metrics : []).filter((m: Metrics) =>
        typeof m.session === 'string' && Number.isFinite(m.at) && m.at > Date.now() - 90 * 86400000 && m.at <= Date.now())
        .slice(-1000).map((m: Metrics) => ({ session: m.session, at: m.at, selected: m.selected === true, executed: m.executed === true })) }
  } catch { return empty() }
}
let state = read()
// Physical pruning on load (including while disabled). Never create a default record.
try { if (localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* best effort */ }
function publish(next: State) {
  state = { ...next, storageError: false }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { state = { ...next, storageError: true } }
  listeners.forEach(listener => listener())
}
export const suggestionStore = {
  get: () => state,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  enable(enabled: boolean) { publish({ ...read(), enabled, epoch: crypto.randomUUID() }); announce(false); syncNative() },
  clear() { publish({ ...empty(), enabled: state.enabled }); announce(true); syncNative() },
}
export function useSuggestionSettings() { return useSyncExternalStore(suggestionStore.subscribe, suggestionStore.get) }
export type SuggestionSession = { id: string; originAppId: string | null; epoch: string; selectedActionKey: string | null }
let current: SuggestionSession | null = null
export function beginSuggestionSession(origin?: unknown) {
  current = { id: crypto.randomUUID(), originAppId: state.enabled && validOrigin(origin) ? origin : null,
    epoch: state.epoch, selectedActionKey: null }
  return current
}
export function getSuggestionSession() { return current }
export function endSuggestionSession() { current = null }
function writable(session: SuggestionSession) {
  if (!state.enabled || state.storageError || state.epoch !== session.epoch) return null
  // Read latest storage too: another window can disable/clear while execution awaits.
  const latest = read()
  return latest.enabled && latest.epoch === session.epoch ? latest : null
}
export function recordSuggestionSuccess(session: SuggestionSession | null, actionKey: string, suggested = session?.selectedActionKey === actionKey) {
  if (!session || !isSuggestionActionKey(actionKey)) return
  const latest = writable(session)
  if (!latest) return
  const at = Date.now()
  const events = retainEvents([...latest.events, { actionKey, originAppId: session.originAppId, at, session: session.id }], at)
  const metrics = latest.metrics.map(m => m.session === session.id && suggested
    ? { ...m, executed: true } : m)
  publish({ ...latest, events, metrics })
}
export function recordSuggestionShown(session: SuggestionSession) {
  const latest = writable(session)
  if (!latest || latest.metrics.some(m => m.session === session.id)) return
  publish({ ...latest, metrics: [...latest.metrics, { session: session.id, at: Date.now(), selected: false, executed: false }].slice(-1000) })
}
export function recordSuggestionSelected(session: SuggestionSession, key: string) {
  const latest = writable(session)
  if (!latest) return
  session.selectedActionKey = key
  publish({ ...latest, metrics: latest.metrics.map(m => m.session === session.id ? { ...m, selected: true } : m) })
}
function announce(cleared: boolean) {
  try { channel?.postMessage({ enabled: state.enabled && !state.storageError, epoch: state.epoch, cleared }) } catch { /* Unavailable channel. */ }
}
if (channel) channel.onmessage = event => {
  const value = event.data
  if (typeof value?.enabled !== 'boolean' || typeof value?.epoch !== 'string') return
  state = { ...state, enabled: value.enabled, epoch: value.epoch,
    ...(value.cleared ? { events: [], metrics: [] } : {}) }
  listeners.forEach(listener => listener()); syncNative()
}
function syncNative() {
  if ('__TAURI_INTERNALS__' in window) void import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke('set_context_suggestions_enabled', { enabled: state.enabled && !state.storageError })).catch(() => {})
}
window.addEventListener('storage', event => {
  if (event.key !== KEY) return
  state = read(); listeners.forEach(listener => listener()); syncNative()
})
syncNative()

// Prune expired rows on a resumed window too; disabling never prevents deletion.
window.addEventListener('focus', () => {
  try {
    const serialized = localStorage.getItem(KEY)
    if (!serialized) return
    const next = read()
    if (JSON.stringify(next) !== serialized) publish(next)
  } catch { /* unavailable storage */ }
})
