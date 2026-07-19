import { useCallback } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { PluginPermission } from '../../workspace/pluginTypes'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { PluginSurfacePermissionGate } from '../pluginSurface/PluginSurfaceRenderer'
import { LauncherHintKey } from './LauncherFooterHints'

export type GlobalLauncherPermissionFrameState = {
  permissions: PluginPermission[]
}

export function GlobalLauncherPermissionFrame({
  frame,
  locale,
  onBack,
  onGrant,
}: {
  frame: GlobalLauncherPermissionFrameState
  locale: Locale
  onBack: () => void
  onGrant: () => void
}) {
  const escapeHandler = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    event.preventDefault()
    event.stopPropagation()
    onBack()
    return true
  }, [onBack])
  useLauncherEscapeInterceptor(escapeHandler)

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onGrant()
    }
  }, [onGrant])

  return (
    <div className="global-launcher-body" style={{ height: 260 }} onKeyDown={handleKeyDown} tabIndex={-1}>
      <PluginSurfacePermissionGate
        permissions={frame.permissions}
        locale={locale}
        onBack={onBack}
        onGrant={onGrant}
      />
      <div className="global-launcher-footer l-foot">
        <LauncherHintKey keys="↵" label={t(locale, 'palette.pluginPermissionAllow')} />
        <LauncherHintKey keys="esc" label={t(locale, 'palette.pluginPermissionBack')} />
      </div>
    </div>
  )
}
