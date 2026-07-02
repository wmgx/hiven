import { lazy, Suspense } from 'react'
import type { LauncherHostSurfaceTarget } from '../../store'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import { SurfaceBreadcrumbHeader } from '../SurfaceBreadcrumbHeader'
import { SystemSettingsSurface } from '../SystemSettingsSurface'
import { QuickEditorPanel } from '../quickEditor/QuickEditorPanel'
import { QuickEditorBreadcrumbActions } from '../quickEditor/QuickEditorBreadcrumbActions'

const SettingsSurface = lazy(() => import('../../surfaces/SettingsSurface').then((mod) => ({ default: mod.SettingsSurface })))
const PluginsSurface = lazy(() => import('../../surfaces/PluginsSurface').then((mod) => ({ default: mod.PluginsSurface })))

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

  if (target === 'system-settings' || target === 'system-plugins') {
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

  return (
    <div
      className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height }}
    >
      <div className="global-launcher-body" style={{ height, maxHeight: height, overflow: 'hidden' }}>
        <Suspense fallback={<div className="view-loading" />}>
          {target === 'settings' ? <SettingsSurface /> : <PluginsSurface />}
        </Suspense>
      </div>
    </div>
  )
}
