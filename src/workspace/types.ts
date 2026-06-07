/**
 * FluxText Workspace Extension - Core Types
 * Milestone 0: Type definitions for Pane, Layout, Command, Effect, Presentation, Panel, Surface
 */

// ─── Pane ───────────────────────────────────────────────────────────────────

export type PaneId = string

export type EditorPane = {
  id: PaneId
  title: string
  text: string
  language?: string
  detectedLanguage?: string
  languageSource?: 'auto' | 'manual'
  stickyScroll?: boolean
  uri?: string
  groupId?: string
}

// ─── Layout ─────────────────────────────────────────────────────────────────

export type WorkspaceLayout =
  | { type: 'single'; panes: [PaneId] }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; panes: PaneId[] }
  | { type: 'grid'; rows: PaneId[][] }

// ─── Serialized Selection ───────────────────────────────────────────────────

export type SerializedSelection = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type SerializedRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

// ─── Command ────────────────────────────────────────────────────────────────

export type InputPolicy = {
  prefer: 'selection' | 'whole-pane' | 'workspace'
  fallback?: 'whole-pane' | 'none'
  minPanes?: number
  maxPanes?: number
  allowInteractivePicker?: boolean
}

export type CommandInput = {
  mode: 'selection' | 'whole-pane' | 'workspace'
  text?: string
  range?: SerializedRange
  paneId?: PaneId
  panes?: PaneId[]
}

export type CommandContext = {
  input: CommandInput
  params: Record<string, any>
  readClipboard: () => Promise<string>
  loadCDN: (url: string) => Promise<any>
  deps: Record<string, any>
}

export type CommandResult = {
  effects: FluxEffect[]
}

export type FluxCommand = {
  id: string
  title: string
  description?: string
  tags?: string[]
  icon?: string
  inputPolicy?: InputPolicy
  run(ctx: CommandContext): CommandResult | Promise<CommandResult>
}

// ─── Effects ────────────────────────────────────────────────────────────────

export type FluxEffect =
  | TextReplaceEffect
  | PaneEffect
  | PaneRendererEffect
  | WorkspaceLayoutEffect
  | PresentationEffect
  | PanelEffect
  | PanelV2Effect
  | MonacoEffect
  | StatusEffect

export type TextReplaceEffect = {
  type: 'text.replace'
  target: 'active-input' | { paneId: PaneId; range?: SerializedRange }
  text: string
}

export type PaneEffect =
  | { type: 'pane.create'; pane: Partial<EditorPane>; focus?: boolean; direction?: 'left' | 'right' | 'top' | 'bottom' }
  | { type: 'pane.close'; paneId?: PaneId }
  | { type: 'pane.focus'; paneId: PaneId }
  | { type: 'pane.update'; paneId: PaneId; patch: Partial<EditorPane> }

/** New plugin-system renderer effects (replaces presentation.open for renderer use cases) */
export type PaneRendererEffect =
  | {
      type: 'pane.setRenderer'
      paneId: PaneId
      /** rendererId from RendererRegistry */
      renderer: string
      /** passed to renderer props.inputs */
      inputs: unknown
      ownerPluginId?: string
      ownerContributionId?: string
      /** When true, prefer dev registry when resolving renderer */
      _isDev?: boolean
    }
  | { type: 'pane.clearRenderer'; paneId: PaneId }

export type WorkspaceLayoutEffect =
  | { type: 'workspace.layout'; layout: WorkspaceLayout }
  | { type: 'workspace.split'; direction: 'horizontal' | 'vertical'; sourcePaneId?: PaneId }

export type PresentationEffect =
  | {
      type: 'presentation.open'
      renderer: string
      mode: 'replace-pane' | 'split-view' | 'inline-layer' | 'overlay'
      targetPaneIds: PaneId[]
      sessionId?: string
      options?: Record<string, unknown>
    }
  | { type: 'presentation.close'; sessionId: string }
  | { type: 'presentation.update'; sessionId: string; options: Record<string, unknown> }

export type PanelPlacement =
  | 'pane-inline'
  | 'pane-bottom'
  | 'pane-right'
  | 'bottom'
  | 'right'
  | 'left'
  | 'floating'
  | 'command-popover'

export type PanelScope =
  | { type: 'pane'; paneId: PaneId }
  | { type: 'workspace' }
  | { type: 'presentation'; sessionId: string }
  | { type: 'pinned-action'; pinnedId: string }

export type PanelBinding = {
  paneIds?: PaneId[]
  activePane?: boolean
  selection?: boolean
}

export type PanelEffect =
  | {
      type: 'panel.open'
      panelId: string
      placement: PanelPlacement
      scope?: PanelScope
      title?: string
      props?: Record<string, unknown>
      bind?: PanelBinding
    }
  | { type: 'panel.close'; instanceId: string }
  | { type: 'panel.update'; instanceId: string; props: Record<string, unknown> }

/** New plugin-system panel effects (single-instance by panelId) */
export type PanelV2Effect =
  | {
      type: 'panel.openV2'
      panelId: string
      placement?: 'bottom' | 'right' | 'left' | 'pane-bottom'
      inputs?: unknown
      title?: string
      ownerPluginId?: string
      scope?: PanelScope
      /** When true, prefer dev registry when resolving panel */
      _isDev?: boolean
    }
  | { type: 'panel.closeV2'; panelId: string }

export type MonacoEffect =
  | {
      type: 'monaco.decorate'
      paneId: PaneId
      decorations: any[] // monaco.editor.IModelDeltaDecoration[]
      owner?: string
    }
  | {
      type: 'monaco.updateOptions'
      paneId: PaneId
      options: Record<string, any>
    }

export type StatusEffect = {
  type: 'status.message'
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  /** If true, status message persists until manually dismissed */
  persistent?: boolean
  /** Auto-dismiss after this many ms (default varies by level) */
  durationMs?: number
}

// ─── Presentation Session ───────────────────────────────────────────────────

export type PresentationSession = {
  id: string
  renderer: string
  mode: 'replace-pane' | 'split-view' | 'inline-layer' | 'overlay'
  targetPaneIds: PaneId[]
  statusLabel?: string
  live: boolean
  editable: boolean
  options: Record<string, unknown>
}

// ─── Panel Instance ─────────────────────────────────────────────────────────

export type PanelInstance = {
  id: string
  panelId: string
  placement: PanelPlacement
  scope: PanelScope
  bind?: PanelBinding
  title: string
  ownerId: string
}

// ─── Surface Coordination ───────────────────────────────────────────────────

export type SurfaceId = string
// e.g. `pane:${PaneId}:renderer` | `pane:${PaneId}:inline-layer` | etc.

export type SurfaceClaim = {
  surfaceId: SurfaceId
  mode: 'exclusive' | 'shared' | 'stacked'
  priority?: number
  zIndex?: number
}

export type ExitPolicy = {
  label?: string
  closeBehavior: 'dispose-only' | 'restore-view' | 'confirm-if-dirty' | 'custom'
  preservesPaneText: boolean
  cleanupOwners?: string[]
}

export type ConflictPolicy =
  | 'reject'
  | 'replace'
  | 'ask'
  | 'reuse-if-same-owner'
  | 'stack-if-supported'

export type SurfaceOccupancy = {
  id: string
  ownerId: string
  ownerKind: 'presentation' | 'panel' | 'extension' | 'system'
  surfaces: SurfaceClaim[]
  title: string
  description?: string
  statusLabel?: string
  exitPolicy: ExitPolicy
}

// ─── Pane Render Stack ──────────────────────────────────────────────────────

export type PaneRenderStackItem = {
  renderer: string
  ownerId: string
  viewState?: unknown
  enteredAt: number
}

// ─── Workspace State ────────────────────────────────────────────────────────

export type WorkspaceState = {
  panes: Record<PaneId, EditorPane>
  paneOrder: PaneId[]
  activePaneId: PaneId
  previousActivePaneId?: PaneId
  layout: WorkspaceLayout
  selections: Record<PaneId, SerializedSelection | null>
  viewStates: Record<PaneId, unknown>
  presentations: Record<string, PresentationSession>
  panels: Record<string, PanelInstance>
  occupancies: Record<string, SurfaceOccupancy>
  renderStacks: Record<PaneId, PaneRenderStackItem[]>
  /** New plugin-system renderer state: paneId → renderer state */
  paneRenderers: Record<PaneId, PaneRendererState>
  /** New plugin-system panel state: panelId → panel instance (single-instance) */
  panelInstancesV2: Record<string, PanelInstanceV2>
}

// ─── Pane Renderer State (plugin system) ────────────────────────────────────

export type PaneRendererState = {
  rendererId: string
  rendererInputs: unknown
  ownerPluginId?: string
  ownerContributionId?: string
  isDevRenderer?: boolean
}

// ─── Panel Instance V2 State (plugin system, single-instance model) ──────────

export type PanelInstanceV2 = {
  panelId: string
  placement: 'bottom' | 'right' | 'left' | 'pane-bottom'
  inputs: unknown
  scope?: PanelScope
  title?: string
  ownerPluginId?: string
  isDevPanel?: boolean
}

// ─── Render Status ──────────────────────────────────────────────────────────

export type RenderStatus = {
  activePaneId: PaneId
  activeRenderer: string
  activePresentations: string[]
  openPanels: string[]
  decorations: { ownerId: string; label: string }[]
}
