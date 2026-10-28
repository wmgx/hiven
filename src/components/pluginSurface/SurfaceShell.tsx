import { forwardRef, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { SurfaceHeaderActionsContext } from '../../ui/SurfaceHeaderActions'
import { WindowFeedback } from '../../ui/WindowFeedback'
import { PluginIcon } from '../../ui/PluginIcon'
import './SurfaceShell.css'

export const SurfaceShell = forwardRef<HTMLDivElement, {
  title: string
  onBack?: () => void
  onClose: () => void
  standalone?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
  tabIndex?: number
  actions?: ReactNode
  titleId?: string
  icon?: string
}>(function SurfaceShell({ title, onBack, onClose, standalone, children, actions, icon, titleId, className = '', ...props }, ref) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const [field, setField] = useState<HTMLDivElement | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<HTMLDivElement | null>(null)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<HTMLDivElement | null>(null)
  const [error, setError] = useState<HTMLDivElement | null>(null)
  const slots = useMemo(() => ({ actions: slot, field, breadcrumbs, footer, status, error }), [slot, field, breadcrumbs, footer, status, error])
  return <div {...props} ref={ref} className={`surface-chrome ${className}`}>
    <div className="surface-chrome-header" data-tauri-drag-region={standalone || undefined}>
      <button type="button" className="surface-shell-tag" id={titleId} data-no-drag onClick={onBack ?? onClose}><PluginIcon icon={icon} title={title} small /><span className="surface-shell-title">{title}</span></button>
      <div ref={setBreadcrumbs} className="surface-shell-breadcrumbs" data-no-drag />
      <div ref={setField} className="surface-chrome-field" data-no-drag />
      <div ref={setSlot} className="surface-chrome-actions" data-no-drag>{actions}</div>
    </div>
    <div ref={setError} className="surface-shell-error" role="alert" />
    <SurfaceHeaderActionsContext.Provider value={slots}>
      <WindowFeedback />
      <div className="surface-chrome-body" data-no-drag>{children}</div>
      <footer className="surface-shell-footer" data-no-drag><div ref={setStatus} className="surface-shell-status" role="status" /><div ref={setFooter} className="surface-shell-footer-actions" /></footer>
    </SurfaceHeaderActionsContext.Provider>
  </div>
})
