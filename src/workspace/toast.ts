/**
 * hiven - Toast Notification System
 * Simple global toast for showing ephemeral messages.
 */

import { create } from 'zustand'
import { dismissRoutedToast, routeToast } from './toastRouting'

export type ToastLevel = 'info' | 'success' | 'error' | 'warning'

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
  addToast: (item) => set((s) => ({ toasts: [...s.toasts.filter((toast) => toast.id !== item.id), item] })),
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
  options?: number | { durationMs?: number; persistent?: boolean; action?: ToastAction; progress?: { completed: number; total: number } }
): string {
  const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`

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
  const desktopDuration = persistent ? 8000 : Math.min(15000, Math.max(1000, durationMs))
  const item: ToastItem = { id, message, level, createdAt, expiresAt: createdAt + desktopDuration, persistent, action, progress: typeof options === 'object' ? options.progress : undefined }
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
  dismissRoutedToast(id)
}
