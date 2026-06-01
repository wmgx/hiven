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
 * Show a toast notification. Auto-dismisses after 3.5s.
 */
export function showToast(message: string, level: ToastLevel = 'info') {
  const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const item: ToastItem = { id, message, level, createdAt: Date.now() }
  useToastStore.getState().addToast(item)

  setTimeout(() => {
    useToastStore.getState().removeToast(id)
  }, 3500)
}
