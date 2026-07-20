/**
 * hiven - Toast Container
 * Renders ephemeral toast notifications at the bottom-right.
 */

import { useEffect, useRef, useState } from 'react'
import { useToastStore, type ToastItem, type ToastLevel } from '../../workspace/toast'

const levelStyles: Record<ToastLevel, { bg: string; color: string }> = {
  info: { bg: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)' },
  success: { bg: 'var(--accent-soft)', color: 'var(--accent)' },
  error: { bg: 'color-mix(in srgb, var(--color-error, #dc2626) 10%, #fff)', color: 'var(--color-error, #dc2626)' },
  warning: { bg: 'color-mix(in srgb, #d97706 12%, #fff)', color: '#d97706' },
}

const EXIT_MS = 150

type RenderedToast = ToastItem & { phase: 'enter' | 'shown' | 'exit' }

export function ToastContainer() {
  const storeToasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const [items, setItems] = useState<RenderedToast[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    setItems((prev) => {
      const storeIds = new Set(storeToasts.map((t) => t.id))
      const prevById = new Map(prev.map((t) => [t.id, t]))
      const next: RenderedToast[] = []

      for (const toast of storeToasts) {
        const existing = prevById.get(toast.id)
        if (existing && existing.phase !== 'exit') {
          next.push({ ...toast, phase: existing.phase === 'enter' ? existing.phase : 'shown' })
        } else if (!existing) {
          next.push({ ...toast, phase: 'enter' })
        }
      }

      // Keep exiting items that left the store until exit animation ends
      for (const item of prev) {
        if (!storeIds.has(item.id) && item.phase !== 'exit') {
          next.push({ ...item, phase: 'exit' })
        } else if (!storeIds.has(item.id) && item.phase === 'exit') {
          next.push(item)
        }
      }

      return next
    })
  }, [storeToasts])

  // Promote enter → shown on next frame
  useEffect(() => {
    const entering = items.filter((t) => t.phase === 'enter')
    if (entering.length === 0) return
    const raf = requestAnimationFrame(() => {
      setItems((prev) =>
        prev.map((t) => (t.phase === 'enter' ? { ...t, phase: 'shown' } : t)),
      )
    })
    return () => cancelAnimationFrame(raf)
  }, [items])

  // Drop finished exits
  useEffect(() => {
    for (const item of items) {
      if (item.phase !== 'exit') continue
      if (timersRef.current.has(item.id)) continue
      const timer = window.setTimeout(() => {
        timersRef.current.delete(item.id)
        setItems((prev) => prev.filter((t) => t.id !== item.id))
      }, EXIT_MS)
      timersRef.current.set(item.id, timer)
    }
  }, [items])

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  function requestRemove(id: string) {
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, phase: 'exit' } : t)),
    )
    window.setTimeout(() => removeToast(id), EXIT_MS)
  }

  if (items.length === 0) return null

  return (
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {items.map((toast) => {
        const style = levelStyles[toast.level]
        const phaseClass =
          toast.phase === 'shown' ? ' is-visible' : toast.phase === 'exit' ? ' is-exiting' : ''
        return (
          <div
            key={toast.id}
            className={`hiven-toast pointer-events-auto px-3 py-2 rounded-md shadow-lg text-[12px] max-w-[320px] flex items-start gap-2${phaseClass}`}
            style={{ background: style.bg, color: style.color, border: '1px solid currentColor', borderColor: `${style.color}33` }}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                className="font-medium underline underline-offset-2 shrink-0 hover:opacity-80"
                onClick={() => {
                  toast.action!.onClick()
                  requestRemove(toast.id)
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              className="opacity-50 hover:opacity-100 shrink-0"
              onClick={() => requestRemove(toast.id)}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
