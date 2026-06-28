import { PluginEditorSurfaceContent } from './PluginEditorSurfaceContent'
import { SurfaceShell } from './SurfaceShell'

export function PluginEditorSurface() {
  return (
    <SurfaceShell id="plugin-editor" kind="plugins" title="Plugin Editor">
      <PluginEditorSurfaceContent />
    </SurfaceShell>
  )
}
