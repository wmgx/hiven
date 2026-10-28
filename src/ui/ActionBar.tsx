import { useContext, type ComponentPropsWithoutRef } from 'react'
import { createPortal } from 'react-dom'
import { SurfaceHeaderActionsContext } from './SurfaceHeaderActions'

/** Keep plugin actions in the shell while the body scrolls. */
export function ActionBar({ className = '', children, ...props }: ComponentPropsWithoutRef<'footer'>) {
  const slot = useContext(SurfaceHeaderActionsContext).footer
  const bar = <footer {...props} className={`hiven-ui-surface-actionbar ${className}`}>{children}</footer>
  return slot ? createPortal(bar, slot) : bar
}
