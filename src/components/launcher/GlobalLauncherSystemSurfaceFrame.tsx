import { useCallback } from 'react'
import type { LauncherHostSurfaceTarget } from '../../store'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { SurfaceBreadcrumbHeader } from '../SurfaceBreadcrumbHeader'
import { SystemSettingsSurface } from '../SystemSettingsSurface'
import { QuickEditorPanel } from '../quickEditor/QuickEditorPanel'
import { QuickEditorBreadcrumbActions } from '../quickEditor/QuickEditorBreadcrumbActions'

const BREADCRUMB_HEIGHT = 40

export function GlobalLauncherSystemSurfaceFrame({
  target,
  height,
  onBack,
  onClose,
}: {
  target: LauncherHostSurfaceTarget
  height: number
  onBack: () => void
  onClose: () => void
}) {
  const locale = useAppStore((s) => s.locale)
  const bodyHeight = height - BREADCRUMB_HEIGHT

  const settingsEscapeHandler = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    event.preventDefault()
    event.stopPropagation()
    onBack()
    return true
  }, [onBack])
  useLauncherEscapeInterceptor(target !== 'quick-editor' ? settingsEscapeHandler : null)

  if (target === 'quick-editor') {
    return (
      <div
        className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
        tabIndex={-1}
        style={{ height }}
      >
        <SurfaceBreadcrumbHeader
          title={t(locale, 'quickEditor.title')}
          onBack={onBack}
          onClose={onClose}
          actions={<QuickEditorBreadcrumbActions />}
        />
        <div className="global-launcher-body" style={{ height: bodyHeight, maxHeight: bodyHeight, overflow: 'hidden' }}>
          <QuickEditorPanel onRequestExit={onBack} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height }}
    >
      <SurfaceBreadcrumbHeader
        title={t(locale, 'systemSettings.title')}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="global-launcher-body" style={{ height: bodyHeight, maxHeight: bodyHeight, overflow: 'hidden' }}>
        <SystemSettingsSurface initialTab={target === 'system-plugins' ? 'plugins' : 'settings'} />
      </div>
    </div>
  )
}
