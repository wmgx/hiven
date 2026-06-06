/**
 * FluxText Workspace Extension - Plugin API
 * Stable public API for extensions to register commands, panels, renderers.
 * 
 * Usage:
 *   import { registerCommand, registerPanel, registerPresentationRenderer } from './pluginApi'
 */

import type { Disposable } from './runtimeRegistry'
import type { PaneId, FluxEffect, PanelPlacement, PanelBinding } from './types'
import { presentationRegistry, type PresentationRendererDef } from './presentationRegistry'
import { panelRegistry, type PanelContribution } from './panelRegistry'
import { useWorkspaceStore } from './workspaceStore'
import { applyEffects } from './effectRunner'
import { monacoBridge, presentationApi } from './monacoBridge'
import { runtimeRegistry } from './runtimeRegistry'

// ─── Extension Context ──────────────────────────────────────────────────────

export interface ExtensionContext {
  subscriptions: Disposable[]
  extensionId: string
}

export interface ExtensionContribution {
  id: string
  activate(ctx: ExtensionContext): Disposable | void
}

// ─── Register Panel ─────────────────────────────────────────────────────────

/**
 * Register a panel contribution (e.g. Regex Tester, Find Replace).
 * Panels can be opened via panel.open effects.
 */
export function registerPanel(contribution: PanelContribution): Disposable {
  panelRegistry.register(contribution)

  return {
    dispose() {
      panelRegistry.unregister(contribution.id)
    },
  }
}

// ─── Register Presentation Renderer ─────────────────────────────────────────

/**
 * Register a presentation renderer (e.g. Monaco Diff, JSON Tree).
 * Renderers are used when a presentation.open effect references their id.
 */
export function registerPresentationRenderer(def: PresentationRendererDef): Disposable {
  presentationRegistry.register(def)

  return {
    dispose() {
      presentationRegistry.unregister(def.id)
    },
  }
}

// ─── Workspace API (read-only access for extensions) ─────────────────────────

export interface WorkspaceApi {
  getActivePaneId(): PaneId
  getActivePaneText(): string
  getPaneText(paneId: PaneId): string | undefined
  getPaneIds(): PaneId[]
  getPaneTitle(paneId: PaneId): string | undefined
}

export const workspaceApi: WorkspaceApi = {
  getActivePaneId() {
    return useWorkspaceStore.getState().activePaneId
  },
  getActivePaneText() {
    return useWorkspaceStore.getState().getActivePaneText()
  },
  getPaneText(paneId) {
    return useWorkspaceStore.getState().panes[paneId]?.text
  },
  getPaneIds() {
    return useWorkspaceStore.getState().paneOrder
  },
  getPaneTitle(paneId) {
    return useWorkspaceStore.getState().panes[paneId]?.title
  },
}

// ─── Effect API (for extensions to execute effects) ──────────────────────────

export function executeEffects(effects: FluxEffect[]) {
  return applyEffects(effects)
}

// ─── Re-exports for convenience ─────────────────────────────────────────────

export { monacoBridge, presentationApi }
export type { MonacoBridgeApi, PresentationApi } from './monacoBridge'
export type { PanelComponentProps, PanelContribution } from './panelRegistry'
export type { PresentationRendererProps, PresentationRendererDef } from './presentationRegistry'
export type { Disposable } from './runtimeRegistry'
export type {
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
} from './types'
