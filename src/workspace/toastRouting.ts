import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import type { ToastItem } from './toast'

let sequence = 0
const pending = new Map<string, { cancelled: boolean; target?: string }>()

export function nativeToastRoutingAvailable() {
  return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ && !window.__HIVEN_WEB_NATIVE_BRIDGE__
}

/** Best-effort native ticket for this operation, never a window ID or geometry. */
export async function captureHudTarget(operation: string, backgroundAction?: 'image-save-shortcut'): Promise<string | undefined> {
  if (!nativeToastRoutingAvailable()) return undefined
  try { return await invoke<string | null>('capture_hud_target', { operation, backgroundAction }) ?? undefined }
  catch { return undefined }
}

export async function routeToast(item: ToastItem, _removeLocal: (id: string) => void) {
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
    // Only notify items carry localized status text; other toast text and
    // action callbacks never enter the desktop HUD.
    await invoke<string | null>('route_toast', {
      id: item.id, level: item.level, expiresAt: item.expiresAt,
      progress: item.progress, receipt: item.hud, sequence: issuedSequence, locale: locale === 'zh' ? 'zh' : 'en', theme,
      slot: item.notify?.slot ?? 'flash', interactive: !!item.notify?.controls, ...(item.notify ? { message: item.message, detail: item.notify.detail } : {}),
    })
  } catch {
    // Inline feedback remains with its owner if the native HUD is unavailable.
  } finally {
    if (ticket.cancelled) { clearTimeout(cleanup); pending.delete(item.id) }
  }
}

export function dismissRoutedToast(id: string) {
  if (!nativeToastRoutingAvailable()) return
  const ticket = pending.get(id)
  if (ticket) ticket.cancelled = true
  void invoke('dismiss_toast', { id }).catch(() => {})
}

export type StatusControls = { cancel(): void }
const statusControls = new Map<string, StatusControls>()
let stopControls: Promise<() => void> | undefined
export function setStatusControls(id: string, controls?: StatusControls) {
  if (controls) statusControls.set(id, controls)
  else statusControls.delete(id)
  if (!stopControls && nativeToastRoutingAvailable()) {
    stopControls = listen<{ id: string; action: 'cancel' }>('hiven://toast-control', ({ payload }) => {
      if (payload.action === 'cancel') statusControls.get(payload.id)?.cancel()
    }).catch(() => { stopControls = undefined; return () => {} })
  }
}
export function requestToastControl(id: string, owner: string | undefined, action: 'cancel') {
  const controls = statusControls.get(id)
  if (controls) { controls[action](); return }
  if (owner && nativeToastRoutingAvailable()) void emitTo(owner, 'hiven://toast-control', { id, action }).catch(() => {})
}
