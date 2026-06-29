import type { Locale } from '../../i18n'
import type { PluginPermission } from '../../workspace/pluginTypes'
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
