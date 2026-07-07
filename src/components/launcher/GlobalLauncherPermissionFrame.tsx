import { useCallback } from 'react'
import type { Locale } from '../../i18n'
import type { PluginPermission } from '../../workspace/pluginTypes'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { PluginSurfacePermissionGate } from '../pluginSurface/PluginSurfaceRenderer'

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

  return (
    <div className="global-launcher-body" style={{ height: 260 }}>
      <PluginSurfacePermissionGate
        permissions={frame.permissions}
        locale={locale}
        onBack={onBack}
        onGrant={onGrant}
      />
    </div>
  )
}
