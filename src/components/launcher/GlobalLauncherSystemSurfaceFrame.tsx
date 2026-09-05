import { lazy, Suspense, useCallback } from 'react'
import type { LauncherHostSurfaceTarget } from '../../store'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { SurfaceBreadcrumbHeader } from '../SurfaceBreadcrumbHeader'
import { SystemSettingsSurface } from '../SystemSettingsSurface'
import { QuickEditorBreadcrumbActions } from '../quickEditor/QuickEditorBreadcrumbActions'
import { loadMonacoNls } from '../../kits/editor/monacoNls'
import { LearningInboxSurface } from '../learning/LearningInboxSurface'

const BREADCRUMB_HEIGHT = 40
const QuickEditorPanel = lazy(async () => {
  await loadMonacoNls()
  const module = await import('../quickEditor/QuickEditorPanel')
  return { default: module.QuickEditorPanel }
})

export function GlobalLauncherSystemSurfaceFrame({
  target,
  exiting,
  height,
  onBack,
  onClose,
}: {
  target: LauncherHostSurfaceTarget
  exiting: boolean
  height: number
  onBack: () => void
  onClose: () => void
}) {
  const locale = useAppStore((s) => s.locale)
  const bodyHeight = height - BREADCRUMB_HEIGHT
  const shellClassName = `global-launcher-host-surface-shell flex flex-col min-h-0 outline-none${exiting ? ' is-exiting' : ''}`

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
        className={shellClassName}
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
          <Suspense fallback={<div className="quick-editor-loading-skeleton" role="status"><div className="plugin-surface-window-message__indicator" />{t(locale, 'quickEditor.loading')}</div>}>
            <QuickEditorPanel onRequestExit={onBack} />
          </Suspense>
        </div>
      </div>
    )
  }

  if (target === 'learning-inbox') {
    return (
      <div className={shellClassName} tabIndex={-1} style={{ height }}>
        <SurfaceBreadcrumbHeader title={t(locale, 'palette.learningInboxTitle')} onBack={onBack} onClose={onClose} />
        <div className="global-launcher-body" style={{ height: bodyHeight, maxHeight: bodyHeight, overflow: 'auto' }}>
          <LearningInboxSurface />
        </div>
      </div>
    )
  }

  return (
    <div
      className={shellClassName}
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
