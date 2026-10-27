import { forwardRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { useT } from '../../i18n'
import { SurfaceHeaderActionsContext } from '../../ui/SurfaceHeaderActions'
import './SurfaceChrome.css'

export const SurfaceChrome = forwardRef<HTMLDivElement, {
  title: string
  onBack?: () => void
  onClose: () => void
  standalone?: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
  tabIndex?: number
}>(function SurfaceChrome({ title, onBack, onClose, standalone, children, className = '', ...props }, ref) {
  const t = useT('palette')
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return <div {...props} ref={ref} className={`surface-chrome ${className}`}>
    <div className="surface-chrome-header" data-tauri-drag-region={standalone || undefined}>
      {onBack && <button type="button" data-no-drag aria-label={t('back')} onClick={onBack}><ChevronLeft size={14} /></button>}
      <span className="surface-chrome-title" data-tauri-drag-region={standalone || undefined}>{title}</span>
      <div ref={setSlot} className="surface-chrome-actions" data-no-drag />
      <button type="button" data-no-drag aria-label={t('close')} onClick={onClose}><X size={14} /></button>
    </div>
    <SurfaceHeaderActionsContext.Provider value={slot}>
      <div className="surface-chrome-body" data-no-drag>{children}</div>
    </SurfaceHeaderActionsContext.Provider>
  </div>
})
