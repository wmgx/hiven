import { SurfaceShell } from './SurfaceShell'
import { SettingsSurfaceContent } from './SettingsSurfaceContent'

export function SettingsSurface() {
  return (
    <SurfaceShell id="settings" kind="settings" title="Settings">
      <SettingsSurfaceContent />
    </SurfaceShell>
  )
}
