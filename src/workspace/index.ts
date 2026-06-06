/**
 * FluxText Workspace Extension - Public API Entry
 * This is the single entry point for extension authors.
 *
 * Example - Panel Extension:
 * ```ts
 * import { registerPanel, executeEffects } from 'fluxtext/workspace'
 *
 * registerPanel({
 *   id: 'my-ext.inspector',
 *   title: 'Inspector',
 *   defaultPlacement: 'bottom',
 *   defaultScope: 'workspace',
 *   component: InspectorPanel,
 * })
 * ```
 *
 * Example - Presentation Renderer:
 * ```ts
 * import { registerPresentationRenderer } from 'fluxtext/workspace'
 *
 * registerPresentationRenderer({
 *   id: 'my-ext.json-tree',
 *   title: 'JSON Tree',
 *   supportedInputCounts: [1],
 *   supportedRoles: ['source'],
 *   supportedModes: ['replace-pane'],
 *   component: JsonTreeRenderer,
 * })
 * ```
 */

export {
  // Registration functions
  registerPanel,
  registerPresentationRenderer,

  // Effect execution
  executeEffects,

  // Read-only workspace access
  workspaceApi,

  // Monaco Bridge
  monacoBridge,
  presentationApi,
} from './pluginApi'

// Re-export types
export type {
  ExtensionContext,
  ExtensionContribution,
  WorkspaceApi,
  MonacoBridgeApi,
  PresentationApi,
  PanelComponentProps,
  PanelContribution,
  PresentationRendererProps,
  PresentationRendererDef,
  Disposable,
  PaneId,
  FluxEffect,
  TextReplaceEffect,
  PaneEffect,
  WorkspaceLayoutEffect,
  PresentationEffect,
  PanelEffect,
  MonacoEffect,
  StatusEffect,
  PresentationSession,
  PanelInstance,
  PanelPlacement,
  PanelBinding,
  PanelScope,
  CommandInput,
  CommandContext,
  CommandResult,
  FluxCommand,
  InputPolicy,
} from './pluginApi'
