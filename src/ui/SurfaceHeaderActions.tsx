import { Children, createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type SurfaceHeaderSlots = { actions: HTMLElement | null; field: HTMLElement | null; breadcrumbs?: HTMLElement | null; footer?: HTMLElement | null; status?: HTMLElement | null; error?: HTMLElement | null }

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

/** Render the main input beside the command tag. */
export function SurfaceHeaderField({ children }: { children: ReactNode }) {
  const slot = useContext(SurfaceHeaderActionsContext).field
  return slot ? createPortal(children, slot) : null
}

export function SurfaceBreadcrumbs({ items }: { items: Array<{ label: string; onClick: () => void }> }) {
  const slot = useContext(SurfaceHeaderActionsContext).breadcrumbs
  return slot ? createPortal(items.map((item, index) => <span className="surface-shell-crumb" key={index}>
    <span aria-hidden>›</span><button type="button" onClick={item.onClick}>{item.label}</button>
  </span>), slot) : null
}

export function SurfaceStatus({ children }: { children: ReactNode }) {
  const slot = useContext(SurfaceHeaderActionsContext).status
  return slot ? createPortal(children, slot) : null
}

export function SurfaceError({ children }: { children: ReactNode }) {
  const slot = useContext(SurfaceHeaderActionsContext).error
  return slot ? createPortal(children, slot) : null
}
