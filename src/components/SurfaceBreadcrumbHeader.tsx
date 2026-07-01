import { ChevronLeft, X } from 'lucide-react'
import './SurfaceBreadcrumbHeader.css'

type SurfaceBreadcrumbHeaderProps = {
  title: string
  onBack: () => void
  onClose: () => void
}

export function SurfaceBreadcrumbHeader({ title, onBack, onClose }: SurfaceBreadcrumbHeaderProps) {
  return (
    <div className="surface-breadcrumb-header">
      <button
        type="button"
        className="surface-breadcrumb-back"
        onClick={onBack}
        aria-label="Back to hiven"
      >
        <ChevronLeft size={14} />
        <span className="surface-breadcrumb-root">hiven</span>
      </button>
      <span className="surface-breadcrumb-separator">/</span>
      <span className="surface-breadcrumb-current">{title}</span>
      <button
        type="button"
        className="surface-breadcrumb-close"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  )
}
