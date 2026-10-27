import { Children, createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const SurfaceHeaderActionsContext = createContext<HTMLElement | null>(null)

/** Render up to three direct action children in the owning surface's header. */
export function SurfaceHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(SurfaceHeaderActionsContext)
  const actions = Children.toArray(children)
  useEffect(() => {
    if (import.meta.env.DEV && actions.length > 3) console.warn('[hiven] SurfaceHeaderActions supports at most three actions.')
  }, [actions.length])
  return slot ? createPortal(actions.slice(0, 3), slot) : null
}
