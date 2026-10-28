import { Children, createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type SurfaceHeaderSlots = { actions: HTMLElement | null; field: HTMLElement | null }

export const SurfaceHeaderActionsContext = createContext<SurfaceHeaderSlots>({ actions: null, field: null })

/** Render up to three direct action children in the owning surface's header. */
export function SurfaceHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(SurfaceHeaderActionsContext).actions
  const actions = Children.toArray(children)
  useEffect(() => {
    if (import.meta.env.DEV && actions.length > 3) console.warn('[hiven] SurfaceHeaderActions supports at most three actions.')
  }, [actions.length])
  return slot ? createPortal(actions.slice(0, 3), slot) : null
}

/** Render one input in place of the header title, like the launcher's top input row. */
export function SurfaceHeaderField({ children }: { children: ReactNode }) {
  const slot = useContext(SurfaceHeaderActionsContext).field
  return slot ? createPortal(children, slot) : null
}
