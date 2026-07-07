/**
 * hiven - Toast Notification System
 * Simple global toast for showing ephemeral messages.
 */

import { create } from 'zustand'

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
  addToast: (item) => set((s) => ({ toasts: [...s.toasts, item] })),
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/**
 * Show a toast notification.
 * @param message - The message to display
 * @param level - Toast severity level (default: 'info')
 * @param options - Optional: { durationMs, persistent, action }
 *   - durationMs: auto-dismiss delay (default 3500ms)
 *   - persistent: if true, toast does not auto-dismiss (overrides durationMs)
 *   - action: optional { label, onClick } for an action button in the toast
 * @returns toast id (can be passed to dismissToast)
 */
export function showToast(
  message: string,
  level: ToastLevel = 'info',
  options?: number | { durationMs?: number; persistent?: boolean; action?: ToastAction }
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

  const item: ToastItem = { id, message, level, createdAt: Date.now(), persistent, action }
  useToastStore.getState().addToast(item)

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
}
