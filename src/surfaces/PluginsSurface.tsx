import { useAppStore } from '../store'
import { PluginEditorSurface } from './PluginEditorSurface'
import { PluginsManagerSurfaceContent } from './PluginsManagerSurfaceContent'
import { SurfaceShell } from './SurfaceShell'

export function PluginsSurface() {
  const pluginEditor = useAppStore((s) => s.pluginEditor)
  return (
    <SurfaceShell id="plugins" kind="plugins" title="Plugins">
      {pluginEditor ? <PluginEditorSurface /> : <PluginsManagerSurfaceContent />}
    </SurfaceShell>
  )
}
