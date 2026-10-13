import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ToastItem } from './toast'

const DELIVERY = 'hiven://toast-delivery'
const DISMISS = 'hiven://toast-dismiss'
let sequence = 0
const pending = new Map<string, { cancelled: boolean; target?: string }>()

export function nativeToastRoutingAvailable() {
  return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ && !window.__HIVEN_WEB_NATIVE_BRIDGE__
}

export async function routeToast(item: ToastItem, removeLocal: (id: string) => void) {
  if (!nativeToastRoutingAvailable()) return
  sequence = Math.max(Date.now() * 1000, sequence + 1)
  const issuedSequence = sequence
  const ticket = { cancelled: false, target: undefined as string | undefined }
  pending.set(item.id, ticket)
  const cleanup = setTimeout(() => pending.delete(item.id), Math.max(0, item.expiresAt - Date.now()) + 1000)
  try {
    const { useAppStore } = await import('../store')
    if (ticket.cancelled || Date.now() >= item.expiresAt) return
    const { locale, theme } = useAppStore.getState().settings
    // Original text and action callbacks never enter the desktop HUD.
    const target = await invoke<string | null>('route_toast', {
      id: item.id, level: item.level, expiresAt: item.expiresAt,
      progress: item.progress, receipt: item.hud, sequence: issuedSequence, locale: locale === 'zh' ? 'zh' : 'en', theme,
    })
    if (!target || target === getCurrentWindow().label) return
    ticket.target = target
    if (ticket.cancelled || Date.now() >= item.expiresAt) return
    // Functions cannot cross webviews. Keep actionable notifications in their
    // owning view, while the visible view receives the same plain status text.
    await emitTo(target, DELIVERY, { ...item, action: undefined, persistent: false })
    if (ticket.cancelled) await emitTo(target, DISMISS, { id: item.id })
    else if (!item.action) removeLocal(item.id)
  } catch {
    // Keep the existing in-window notification on native transport failure.
  } finally {
    if (ticket.cancelled) { clearTimeout(cleanup); pending.delete(item.id) }
  }
}

export function dismissRoutedToast(id: string) {
  if (!nativeToastRoutingAvailable()) return
  const ticket = pending.get(id)
  if (ticket) ticket.cancelled = true
  void invoke('dismiss_toast', { id }).catch(() => {})
  if (ticket?.target) void emitTo(ticket.target, DISMISS, { id }).catch(() => {})
}

export async function listenForRoutedToasts(add: (item: ToastItem) => void, remove: (id: string) => void) {
  if (!nativeToastRoutingAvailable()) return () => {}
  const dismissals = new Set<string>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, delay)
    timers.add(timer)
  }
  const stopDismiss = await listen<{ id: string }>(DISMISS, ({ payload }) => {
    dismissals.add(payload.id)
    remove(payload.id)
    schedule(() => dismissals.delete(payload.id), 16000)
  })
  const stopDelivery = await listen<ToastItem>(DELIVERY, ({ payload }) => {
    if (dismissals.has(payload.id) || Date.now() >= payload.expiresAt) return
    add({ ...payload, action: undefined, persistent: false })
    schedule(() => remove(payload.id), Math.max(0, payload.expiresAt - Date.now()))
  }).catch(() => { stopDismiss(); return () => {} })
  return () => { stopDismiss(); stopDelivery(); timers.forEach(clearTimeout) }
}
