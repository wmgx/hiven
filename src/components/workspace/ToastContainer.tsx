/**
 * hiven - Toast Container
 * Renders ephemeral toast notifications at the bottom-right.
 */

import { useToastStore } from '../../workspace/toast'
import type { ToastLevel } from '../../workspace/toast'

const levelStyles: Record<ToastLevel, { bg: string; color: string }> = {
  info: { bg: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)' },
  success: { bg: 'var(--accent-soft)', color: 'var(--accent)' },
  error: { bg: '#fef2f2', color: '#dc2626' },
  warning: { bg: '#fffbeb', color: '#d97706' },
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const style = levelStyles[toast.level]
        return (
          <div
            key={toast.id}
            className="pointer-events-auto px-3 py-2 rounded-md shadow-lg text-[12px] max-w-[320px] animate-slide-in-right flex items-start gap-2"
            style={{ background: style.bg, color: style.color, border: '1px solid currentColor', borderColor: `${style.color}33` }}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              className="opacity-50 hover:opacity-100 shrink-0"
              onClick={() => removeToast(toast.id)}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
