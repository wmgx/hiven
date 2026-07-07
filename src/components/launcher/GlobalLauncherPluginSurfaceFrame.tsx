import { useCallback } from 'react'
import type { Locale } from '../../i18n'
import type { PluginSurfaceOpenTarget } from '../../store'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { PluginSurfaceRenderer } from '../pluginSurface/PluginSurfaceRenderer'
import { SurfaceBreadcrumbHeader } from '../SurfaceBreadcrumbHeader'

const BREADCRUMB_HEIGHT = 40

export function GlobalLauncherPluginSurfaceFrame({
  target,
  locale,
  shellHeight,
  breadcrumbTitle,
  onBack,
  onClose,
}: {
  target: PluginSurfaceOpenTarget
  locale: Locale
  shellHeight: number
  breadcrumbTitle?: string
  onBack: () => void
  onClose: () => void
}) {
  const bodyHeight = breadcrumbTitle ? shellHeight - BREADCRUMB_HEIGHT : shellHeight

  const escapeHandler = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    event.preventDefault()
    event.stopPropagation()
    onBack()
    return true
  }, [onBack])
  useLauncherEscapeInterceptor(escapeHandler)

  return (
    <div
      className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height: shellHeight }}
    >
      {breadcrumbTitle && (
        <SurfaceBreadcrumbHeader
          title={breadcrumbTitle}
          onBack={onBack}
          onClose={onClose}
        />
      )}
      <div className="global-launcher-body" style={{ maxHeight: bodyHeight, height: bodyHeight, overflow: 'hidden' }}>
        <PluginSurfaceRenderer
          target={target}
          locale={locale}
          presentation="global-launcher"
          contextSurfaceId="global-launcher"
          onBack={onBack}
          onClose={onClose}
        />
      </div>
    </div>
  )
}
