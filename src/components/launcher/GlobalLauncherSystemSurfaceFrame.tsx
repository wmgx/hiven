import { lazy, Suspense } from 'react'
import type { LauncherHostSurfaceTarget } from '../../store'

const SettingsSurface = lazy(() => import('../../surfaces/SettingsSurface').then((mod) => ({ default: mod.SettingsSurface })))
const PluginsSurface = lazy(() => import('../../surfaces/PluginsSurface').then((mod) => ({ default: mod.PluginsSurface })))

export function GlobalLauncherSystemSurfaceFrame({
  target,
  height,
}: {
  target: LauncherHostSurfaceTarget
  height: number
}) {
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
