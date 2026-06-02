/**
 * FluxText - Toast Notification System
 * Simple global toast for showing ephemeral messages.
 */

import { create } from 'zustand'

export type ToastLevel = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: string
  message: string
  level: ToastLevel
  createdAt: number
  /** If true, toast will not auto-dismiss */
  persistent?: boolean
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
 * @param options - Optional: { durationMs, persistent }
 *   - durationMs: auto-dismiss delay (default 3500ms)
 *   - persistent: if true, toast does not auto-dismiss (overrides durationMs)
 */
export function showToast(
  message: string,
  level: ToastLevel = 'info',
  options?: number | { durationMs?: number; persistent?: boolean }
) {
  const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`

  let persistent = false
  let durationMs = 3500

  if (typeof options === 'number') {
    durationMs = options
  } else if (options) {
    persistent = options.persistent ?? false
    durationMs = options.durationMs ?? 3500
  }

  const item: ToastItem = { id, message, level, createdAt: Date.now(), persistent }
  useToastStore.getState().addToast(item)

  if (!persistent) {
    setTimeout(() => {
      useToastStore.getState().removeToast(id)
    }, durationMs)
  }
}
