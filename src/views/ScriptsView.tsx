import { PluginsManagerSurfaceContent } from '../surfaces/PluginsManagerSurfaceContent'

/** Compatibility wrapper for older imports. Plugin manager implementation lives in the surface layer. */
export function ScriptsView() {
  return <PluginsManagerSurfaceContent />
}
