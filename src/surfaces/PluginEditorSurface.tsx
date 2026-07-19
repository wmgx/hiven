import { useEffect } from 'react'
import { markSurfaceInstanceState, upsertSurfaceInstance } from './registry'
import { PluginEditorSurfaceContent } from './PluginEditorSurfaceContent'
import type { PluginEditorState } from './pluginEditorState'
import { SurfaceShell } from './SurfaceShell'

type PluginEditorSurfaceProps = {
  pluginEditor: PluginEditorState
  onClose: () => void
}

export function PluginEditorSurface({ pluginEditor, onClose }: PluginEditorSurfaceProps) {
  const instanceId = pluginEditorSurfaceInstanceId(pluginEditor)

  useEffect(() => {
    upsertSurfaceInstance({
      id: instanceId,
      kind: 'plugin-editor',
      windowLabel: 'launcher',
      title: `Plugin Editor - ${pluginEditor.pluginId}`,
      pluginId: pluginEditor.pluginId,
      surfaceId: pluginEditor.activeFile ?? 'plugin-editor',
      folderPath: pluginEditor.folderPath,
      state: 'visible',
      canReceiveText: false,
      canProvideText: true,
      canAttachToEditor: false,
    })
    return () => markSurfaceInstanceState(instanceId, 'hidden')
  }, [instanceId, pluginEditor.activeFile, pluginEditor.pluginId])

  return (
    <SurfaceShell id="plugin-editor" kind="plugin-editor" title="Plugin Editor">
      <PluginEditorSurfaceContent pluginEditor={pluginEditor} onClose={onClose} />
    </SurfaceShell>
  )
}

function pluginEditorSurfaceInstanceId(pluginEditor: PluginEditorState): string {
  const source = pluginEditor.source ?? 'installed'
  return `host-surface:plugin-editor:${source}:${pluginEditor.pluginId}`
}
