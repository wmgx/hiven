import { PluginEditorSurfaceContent } from './PluginEditorSurfaceContent'
import type { PluginEditorState } from './pluginEditorState'
import { SurfaceShell } from './SurfaceShell'

type PluginEditorSurfaceProps = {
  pluginEditor: PluginEditorState
  onClose: () => void
}

export function PluginEditorSurface({ pluginEditor, onClose }: PluginEditorSurfaceProps) {
  return (
    <SurfaceShell id="plugin-editor" kind="plugins" title="Plugin Editor">
      <PluginEditorSurfaceContent pluginEditor={pluginEditor} onClose={onClose} />
    </SurfaceShell>
  )
}
