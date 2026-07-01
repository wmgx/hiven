import { PluginsContent } from './PluginsContent'
import type { PluginEditorState } from './pluginEditorState'

type PluginsManagerSurfaceContentProps = {
  onOpenPluginEditor: (pluginEditor: PluginEditorState) => void
}

export function PluginsManagerSurfaceContent({ onOpenPluginEditor }: PluginsManagerSurfaceContentProps) {
  return (
    <div className="scripts-content body">
      <PluginsContent onOpenPluginEditor={onOpenPluginEditor} />
    </div>
  )
}
