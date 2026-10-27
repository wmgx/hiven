/**
 * hiven - Toast Notification System
 * Simple global toast for showing ephemeral messages.
 */

import { create } from 'zustand'
import { dismissRoutedToast, routeToast, setStatusControls } from './toastRouting'

export type ToastLevel = 'info' | 'success' | 'error' | 'warning'

/** Anti-replay identity for one output operation; never carries text. */
export type HudReceipt = { operation: string; revision: number; target?: string }
/** Present only on `notify` items: their localized status text may reach the desktop HUD. */
export type ToastNotify = { slot: 'flash' | 'status'; detail?: string; controls?: { owner?: string } }

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  message: string
  level: ToastLevel
  createdAt: number
  /** Bounded desktop/cross-window delivery lifetime, including persistent toasts. */
  expiresAt: number
  /** Host-authored progress only; no user content. */
  progress?: { completed: number; total: number }
  hud?: HudReceipt
  notify?: ToastNotify
  /** If true, toast will not auto-dismiss */
  persistent?: boolean
  /** Optional action button displayed in the toast */
  action?: ToastAction
}

interface ToastStore {
  toasts: ToastItem[]
  addToast: (item: ToastItem) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (item) => set((s) => {
    if (item.hud && s.toasts.some(old => old.hud?.operation === item.hud!.operation && old.hud.revision >= item.hud!.revision)) return s
    return { toasts: [...s.toasts.filter(old => old.id !== item.id && (!item.hud || old.hud?.operation !== item.hud.operation)), item] }
  }),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/**
 * Show a toast notification.
 * @param message - The message to display
 * @param level - Toast severity level (default: 'info')
 * @param options - Optional: { durationMs, persistent, action, progress }
 *   - durationMs: auto-dismiss delay (default 3500ms)
 *   - persistent: if true, toast does not auto-dismiss (overrides durationMs)
 *   - action: optional { label, onClick } for an action button in the toast
 * @returns toast id (can be passed to dismissToast)
 */
export function showToast(
  message: string,
  level: ToastLevel = 'info',
  options?: number | { id?: string; durationMs?: number; persistent?: boolean; action?: ToastAction; progress?: { completed: number; total: number }; hud?: HudReceipt; notify?: ToastNotify }
): string {
  const hud = typeof options === 'object' ? options.hud : undefined
  const existing = hud && useToastStore.getState().toasts.find(item => item.hud?.operation === hud.operation && item.hud.revision >= hud.revision)
  if (existing) return existing.id
  const id = (typeof options === 'object' && options.id) || `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const notify = typeof options === 'object' ? options.notify : undefined

  let persistent = false
  let durationMs = 3500
  let action: ToastAction | undefined

  if (typeof options === 'number') {
    durationMs = options
  } else if (options) {
    persistent = options.persistent ?? false
    durationMs = options.durationMs ?? 3500
    action = options.action
  }

  const createdAt = Date.now()
  // A status lives until its session ends; the native bound only stops leaks.
  const desktopDuration = notify?.slot === 'status' ? 590_000 : persistent ? 8000 : Math.min(15000, Math.max(1000, durationMs))
  const item: ToastItem = { id, message, level, createdAt, expiresAt: createdAt + desktopDuration, persistent, action, hud, notify, progress: typeof options === 'object' ? options.progress : undefined }
  useToastStore.getState().addToast(item)
  void routeToast(item, (toastId) => useToastStore.getState().removeToast(toastId))

  if (!persistent) {
    setTimeout(() => {
      useToastStore.getState().removeToast(id)
    }, durationMs)
  }

  return id
}

/**
 * Dismiss a toast by id before its auto-dismiss timer.
 */
export function dismissToast(id: string) {
  useToastStore.getState().removeToast(id)
  setStatusControls(id)
  dismissRoutedToast(id)
}
