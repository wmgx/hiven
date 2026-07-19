import type { ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import './SurfaceBreadcrumbHeader.css'

type SurfaceBreadcrumbHeaderProps = {
  title: string
  onBack: () => void
  onClose: () => void
  actions?: ReactNode
}

export function SurfaceBreadcrumbHeader({ title, onBack, onClose, actions }: SurfaceBreadcrumbHeaderProps) {
  return (
    <div className="surface-breadcrumb-header">
      <button
        type="button"
        className="surface-breadcrumb-back"
        onClick={onBack}
        aria-label="Back"
      >
        <ChevronLeft size={14} />
        <span className="surface-breadcrumb-root">hiven</span>
      </button>
      <span className="surface-breadcrumb-separator">/</span>
      <span className="surface-breadcrumb-current">{title}</span>
      <div className="surface-breadcrumb-actions">
        {actions}
        <button
          type="button"
          className="surface-breadcrumb-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
