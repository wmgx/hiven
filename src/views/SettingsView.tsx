import { SettingsSurfaceContent } from '../surfaces/SettingsSurfaceContent'

/** Compatibility wrapper for older imports. Settings implementation lives in the surface layer. */
export function SettingsView() {
  return <SettingsSurfaceContent />
}
