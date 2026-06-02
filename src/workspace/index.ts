/**
 * FluxText Workspace Extension - Public API Entry
 * This is the single entry point for extension authors.
 * 
 * Example - Minimal Command:
 * ```ts
 * import { registerCommand } from 'fluxtext/workspace'
 * 
 * registerCommand({
 *   name: 'my-ext.hello',
 *   title: 'Hello World',
 *   tags: ['example'],
 *   builtin: false,
 *   run: (text) => `Hello, ${text}!`,
 * })
 * ```
 * 
 * Example - Panel Extension:
 * ```ts
 * import { registerPanel, registerCommand, executeEffects } from 'fluxtext/workspace'
 * 
 * registerPanel({
 *   id: 'my-ext.inspector',
 *   title: 'Inspector',
 *   defaultPlacement: 'bottom',
 *   defaultScope: 'workspace',
 *   component: InspectorPanel,
 * })
 * 
 * registerCommand({
 *   name: 'my-ext.open-inspector',
 *   title: 'Open Inspector',
 *   tags: ['panel'],
 *   builtin: false,
 *   run: () => {
 *     executeEffects([{
 *       type: 'panel.open',
 *       panelId: 'my-ext.inspector',
 *       placement: 'bottom',
 *       title: 'Inspector',
 *     }])
 *     return undefined as any
 *   },
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
  registerCommand,
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
