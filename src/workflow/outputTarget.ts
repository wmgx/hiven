import type { TextRange } from '../workspace/launcher/types'
import type { PluginSurfaceOpenTarget } from '../store'

export type OutputTarget =
  | { kind: 'copy' }
  | { kind: 'paste-to-foreground-app' }
  | { kind: 'replace-editor-selection'; windowId?: string; paneId?: string; range?: TextRange }
  | { kind: 'insert-into-editor'; windowId?: string; paneId?: string }
  | { kind: 'open-in-editor'; language?: string; title?: string }
  | { kind: 'open-plugin-surface'; pluginId: string; surfaceId: string; source?: 'builtin' | 'installed' | 'dev' }
  | { kind: 'attach-editor-panel'; panelId: string; placement: 'right' | 'bottom' | 'left'; pluginSurfaceTarget?: PluginSurfaceOpenTarget }
  | { kind: 'save-to-shelf' }

export type ActionResult =
  | { ok: true; text?: string; outputTarget?: OutputTarget }
  | { ok: false; error: string }
