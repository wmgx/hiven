import type { ReactNode } from 'react'
import type { SurfaceInstanceKind } from './registry'

export type AppSurfaceId = 'settings' | 'plugins' | 'plugin-editor'

export function SurfaceShell({
  id,
  kind,
  title,
  children,
}: {
  id: AppSurfaceId
  kind: SurfaceInstanceKind
  title: string
  children: ReactNode
}) {
  return (
    <section
      className={`surface-root surface-${id}`}
      data-surface-id={id}
      data-surface-kind={kind}
      aria-label={title}
      role="region"
    >
      {children}
    </section>
  )
}
