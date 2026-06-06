/**
 * FluxText Plugin System - Plugin Registry
 * Manages registered contributions from plugins.
 * 
 * Architecture:
 *   - productionRegistry: contributions from installed+enabled plugins
 *   - devRegistry: contributions from side-loaded dev plugins (session-scoped)
 *   - resolveXxx: looks up in both registries, dev takes priority for same-id
 *
 * Lookup behavior:
 *   - [DEV] commands → dev registry commands/renderers/panels
 *   - Normal commands → production registry commands/renderers/panels
 */

import { useSyncExternalStore } from 'react'
import type {
  CommandContribution,
  RendererContribution,
  PanelContributionV2,
  ToolbarContribution,
  ContributionMeta,
  ContributionSource,
} from './pluginTypes'

// ─── Registry Entry ───────────────────────────────────────────────────────────

type CommandEntry = {
  contribution: CommandContribution
  meta: ContributionMeta
}

type RendererEntry = {
  contribution: RendererContribution
  meta: ContributionMeta
}

type PanelEntry = {
  contribution: PanelContributionV2
  meta: ContributionMeta
}

type ToolbarEntry = {
  contribution: ToolbarContribution
  meta: ContributionMeta
}

// ─── Single-scope Registry ────────────────────────────────────────────────────

class ScopedCommandRegistry {
  private commands = new Map<string, CommandEntry>()

  register(contribution: CommandContribution, pluginId: string, source: ContributionSource): void {
    this.commands.set(contribution.id, {
      contribution,
      meta: { pluginId, source },
    })
  }

  get(id: string): CommandEntry | undefined {
    return this.commands.get(id)
  }

  getAll(): CommandEntry[] {
    return Array.from(this.commands.values())
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [id, entry] of this.commands) {
      if (entry.meta.pluginId === pluginId) {
        this.commands.delete(id)
      }
    }
  }

  unregister(id: string): void {
    this.commands.delete(id)
  }

  clear(): void {
    this.commands.clear()
  }

  has(id: string): boolean {
    return this.commands.has(id)
  }
}

class ScopedRendererRegistry {
  private renderers = new Map<string, RendererEntry>()

  register(contribution: RendererContribution, pluginId: string, source: ContributionSource): void {
    this.renderers.set(contribution.id, {
      contribution,
      meta: { pluginId, source },
    })
  }

  get(id: string): RendererEntry | undefined {
    return this.renderers.get(id)
  }

  getAll(): RendererEntry[] {
    return Array.from(this.renderers.values())
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [id, entry] of this.renderers) {
      if (entry.meta.pluginId === pluginId) {
        this.renderers.delete(id)
      }
    }
  }

  unregister(id: string): void {
    this.renderers.delete(id)
  }

  clear(): void {
    this.renderers.clear()
  }

  has(id: string): boolean {
    return this.renderers.has(id)
  }

  /** Get all renderer IDs owned by a specific plugin */
  getIdsByPlugin(pluginId: string): string[] {
    const ids: string[] = []
    for (const [id, entry] of this.renderers) {
      if (entry.meta.pluginId === pluginId) ids.push(id)
    }
    return ids
  }
}

class ScopedPanelRegistry {
  private panels = new Map<string, PanelEntry>()

  register(contribution: PanelContributionV2, pluginId: string, source: ContributionSource): void {
    this.panels.set(contribution.id, {
      contribution,
      meta: { pluginId, source },
    })
  }

  get(id: string): PanelEntry | undefined {
    return this.panels.get(id)
  }

  getAll(): PanelEntry[] {
    return Array.from(this.panels.values())
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [id, entry] of this.panels) {
      if (entry.meta.pluginId === pluginId) {
        this.panels.delete(id)
      }
    }
  }

  unregister(id: string): void {
    this.panels.delete(id)
  }

  clear(): void {
    this.panels.clear()
  }

  has(id: string): boolean {
    return this.panels.has(id)
  }

  getIdsByPlugin(pluginId: string): string[] {
    const ids: string[] = []
    for (const [id, entry] of this.panels) {
      if (entry.meta.pluginId === pluginId) ids.push(id)
    }
    return ids
  }
}

class ScopedToolbarRegistry {
  private items = new Map<string, ToolbarEntry>()

  register(contribution: ToolbarContribution, pluginId: string, source: ContributionSource): void {
    this.items.set(contribution.id, {
      contribution,
      meta: { pluginId, source },
    })
  }

  getAll(): ToolbarEntry[] {
    return Array.from(this.items.values())
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [id, entry] of this.items) {
      if (entry.meta.pluginId === pluginId) {
        this.items.delete(id)
      }
    }
  }

  clear(): void {
    this.items.clear()
  }
}

// ─── Combined Plugin Registry ─────────────────────────────────────────────────

class PluginRegistryImpl {
  private version = 0
  private listeners = new Set<() => void>()

  readonly production = {
    commands: new ScopedCommandRegistry(),
    renderers: new ScopedRendererRegistry(),
    panels: new ScopedPanelRegistry(),
    toolbar: new ScopedToolbarRegistry(),
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion(): number {
    return this.version
  }

  private bumpVersion(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  readonly dev = {
    commands: new ScopedCommandRegistry(),
    renderers: new ScopedRendererRegistry(),
    panels: new ScopedPanelRegistry(),
    toolbar: new ScopedToolbarRegistry(),
  }

  // ─── Production ────────────────────────────────────────────────────────────

  registerProductionPlugin(
    pluginId: string,
    commands: CommandContribution[],
    renderers: RendererContribution[],
    panels: PanelContributionV2[],
    toolbar: ToolbarContribution[] = []
  ): void {
    for (const cmd of commands) {
      this.production.commands.register(cmd, pluginId, 'production')
    }
    for (const rdr of renderers) {
      this.production.renderers.register(rdr, pluginId, 'production')
    }
    for (const pnl of panels) {
      this.production.panels.register(pnl, pluginId, 'production')
    }
    for (const tb of toolbar) {
      this.production.toolbar.register(tb, pluginId, 'production')
    }
    this.bumpVersion()
  }

  unregisterProductionPlugin(pluginId: string): void {
    this.production.commands.unregisterByPlugin(pluginId)
    this.production.renderers.unregisterByPlugin(pluginId)
    this.production.panels.unregisterByPlugin(pluginId)
    this.production.toolbar.unregisterByPlugin(pluginId)
    this.bumpVersion()
  }

  // ─── Dev ───────────────────────────────────────────────────────────────────

  registerDevPlugin(
    pluginId: string,
    commands: CommandContribution[],
    renderers: RendererContribution[],
    panels: PanelContributionV2[],
    toolbar: ToolbarContribution[] = []
  ): void {
    for (const cmd of commands) {
      this.dev.commands.register(cmd, pluginId, 'dev')
    }
    for (const rdr of renderers) {
      this.dev.renderers.register(rdr, pluginId, 'dev')
    }
    for (const pnl of panels) {
      this.dev.panels.register(pnl, pluginId, 'dev')
    }
    for (const tb of toolbar) {
      this.dev.toolbar.register(tb, pluginId, 'dev')
    }
    this.bumpVersion()
  }

  unregisterDevPlugin(pluginId: string): void {
    this.dev.commands.unregisterByPlugin(pluginId)
    this.dev.renderers.unregisterByPlugin(pluginId)
    this.dev.panels.unregisterByPlugin(pluginId)
    this.dev.toolbar.unregisterByPlugin(pluginId)
    this.bumpVersion()
  }

  clearAllDev(): void {
    this.dev.commands.clear()
    this.dev.renderers.clear()
    this.dev.panels.clear()
    this.dev.toolbar.clear()
    this.bumpVersion()
  }

  // ─── Resolve (unified lookup) ───────────────────────────────────────────────

  /**
   * Resolve a command from either registry.
   * For [DEV] commands, prefer dev registry; otherwise use production.
   */
  resolveCommand(id: string, source?: ContributionSource): CommandEntry | undefined {
    if (source === 'dev') {
      return this.dev.commands.get(id) ?? this.production.commands.get(id)
    }
    return this.production.commands.get(id) ?? this.dev.commands.get(id)
  }

  /**
   * Resolve a renderer from either registry.
   * Dev registry renderers take priority when source context is 'dev'.
   */
  resolveRenderer(id: string, preferDev?: boolean): RendererEntry | undefined {
    if (preferDev) {
      return this.dev.renderers.get(id) ?? this.production.renderers.get(id)
    }
    return this.production.renderers.get(id) ?? this.dev.renderers.get(id)
  }

  /**
   * Resolve a panel from either registry.
   */
  resolvePanel(id: string, preferDev?: boolean): PanelEntry | undefined {
    if (preferDev) {
      return this.dev.panels.get(id) ?? this.production.panels.get(id)
    }
    return this.production.panels.get(id) ?? this.dev.panels.get(id)
  }

  // ─── Query all commands (for CommandPalette) ──────────────────────────────

  /** Get all production commands */
  getAllProductionCommands(): CommandEntry[] {
    return this.production.commands.getAll()
  }

  /** Get all dev commands (shown with [DEV] in CommandPalette) */
  getAllDevCommands(): CommandEntry[] {
    return this.dev.commands.getAll()
  }

  /** Get all commands from all sources (for CommandPalette listing) */
  getAllCommands(): Array<CommandEntry & { isDev: boolean }> {
    const result: Array<CommandEntry & { isDev: boolean }> = []
    for (const entry of this.production.commands.getAll()) {
      result.push({ ...entry, isDev: false })
    }
    for (const entry of this.dev.commands.getAll()) {
      result.push({ ...entry, isDev: true })
    }
    return result
  }

  /** Get all toolbar items from all sources (for toolbar hosts) */
  getAllToolbarItems(): Array<ToolbarEntry & { isDev: boolean }> {
    const result: Array<ToolbarEntry & { isDev: boolean }> = []
    for (const entry of this.production.toolbar.getAll()) {
      result.push({ ...entry, isDev: false })
    }
    for (const entry of this.dev.toolbar.getAll()) {
      result.push({ ...entry, isDev: true })
    }
    return result
  }

  /** Get all renderer IDs owned by a plugin (both registries) */
  getPluginRendererIds(pluginId: string): string[] {
    return [
      ...this.production.renderers.getIdsByPlugin(pluginId),
      ...this.dev.renderers.getIdsByPlugin(pluginId),
    ]
  }

  /** Get all panel IDs owned by a plugin (both registries) */
  getPluginPanelIds(pluginId: string): string[] {
    return [
      ...this.production.panels.getIdsByPlugin(pluginId),
      ...this.dev.panels.getIdsByPlugin(pluginId),
    ]
  }
}

/** Singleton plugin registry - the central source of truth for all plugin contributions */
export const pluginRegistry = new PluginRegistryImpl()

export function usePluginRegistryVersion(): number {
  return useSyncExternalStore(
    (listener) => pluginRegistry.subscribe(listener),
    () => pluginRegistry.getVersion(),
    () => pluginRegistry.getVersion()
  )
}

// Re-export types for convenience
export type { CommandEntry, RendererEntry, PanelEntry, ToolbarEntry }
