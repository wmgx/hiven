import type { PluginSurfaceOpenTarget } from '../store'
import type { PanelPlacement, PanelScope, SerializedRange } from '../workspace/types'

export type OutputTarget =
  | { type: 'copy' }
  | { type: 'paste-to-foreground-app' }
  | { type: 'replace-editor-selection'; paneId?: string; range?: SerializedRange }
  | { type: 'insert-into-editor'; paneId?: string; range?: SerializedRange }
  | { type: 'open-in-editor'; title?: string; language?: string; openEditor?: true }
  | { type: 'open-plugin-surface'; target: PluginSurfaceOpenTarget }
  | {
      type: 'attach-editor-panel'
      panelId: string
      placement?: Extract<PanelPlacement, 'bottom' | 'right' | 'left' | 'pane-bottom'>
      scope?: PanelScope
      title?: string
      inputs?: unknown
      ownerPluginId?: string
    }
  | { type: 'save-to-shelf'; shelfId?: string }

export type TextOutput = {
  text: string
  title?: string
  language?: string
  metadata?: Record<string, unknown>
}
