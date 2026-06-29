import { useEffect, useState } from 'react'
import { PluginEditorSurface } from './PluginEditorSurface'
import { subscribePluginEditorSurfaceOpen } from './pluginEditorSurfaceBridge'
import type { PluginEditorState } from './pluginEditorState'
import { PluginsManagerSurfaceContent } from './PluginsManagerSurfaceContent'
import { SurfaceShell } from './SurfaceShell'

export function PluginsSurface() {
  const [pluginEditor, setPluginEditor] = useState<PluginEditorState | null>(null)

  useEffect(() => subscribePluginEditorSurfaceOpen(setPluginEditor), [])

  return (
    <SurfaceShell id="plugins" kind="plugins" title="Plugins">
      {pluginEditor
        ? <PluginEditorSurface pluginEditor={pluginEditor} onClose={() => setPluginEditor(null)} />
        : <PluginsManagerSurfaceContent onOpenPluginEditor={setPluginEditor} />}
    </SurfaceShell>
  )
}
