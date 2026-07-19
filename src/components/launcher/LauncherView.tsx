import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import type { LauncherHostId } from '../../workspace/launcher/types'

type LauncherViewProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  hostId: LauncherHostId
  busy?: boolean
  children: ReactNode
}

export const LauncherView = forwardRef<HTMLDivElement, LauncherViewProps>(function LauncherView(
  { hostId, busy = false, children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-launcher-host={hostId}
      aria-busy={busy || undefined}
      className={className}
      {...props}
    >
      {children}
    </div>
  )
})
