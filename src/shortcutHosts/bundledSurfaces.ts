import type { PluginDefinition, PluginPermission, PluginPermissionSnapshot, PluginUiSurfaceContribution } from '../workspace/pluginTypes'
import { isCurrentBundledDefinition } from '../workspace/bundledPluginIdentity'
import { getPluginPermissionSnapshot, missingPluginPermissions } from '../workspace/pluginPermissions'
import { pluginRegistry } from '../workspace/pluginRegistry'

/** A surface contribution of a bundled plugin that opted into an app-hosted shortcut task. */
export type BundledSurfaceTask<TContribution> = {
  pluginId: string
  surfaceId: string
  definition: PluginDefinition
  contribution: TContribution
}

export const BUNDLED_SOURCE = 'builtin' as const

/** Only the live, exact bundled definitions; an installed package cannot opt in by id. */
export function listBundledSurfaceTasks<TContribution>(
  pick: (surface: PluginUiSurfaceContribution) => TContribution | undefined,
): BundledSurfaceTask<TContribution>[] {
  const tasks: BundledSurfaceTask<TContribution>[] = []
  for (const { pluginId, definition, source } of pluginRegistry.getAllPluginDefinitions()) {
    if (source !== 'production' || !isCurrentBundledDefinition(pluginId, BUNDLED_SOURCE, definition)) continue
    for (const surface of definition.ui?.surfaces ?? []) {
      const contribution = pick(surface)
      if (contribution) tasks.push({ pluginId, surfaceId: surface.id, definition, contribution })
    }
  }
  return tasks
}

/** Granted snapshot when the manifest declares and the user granted every required permission. */
export function grantedPermissions(pluginId: string, required: readonly PluginPermission[]): PluginPermissionSnapshot | null {
  const requested = pluginRegistry.getPluginPermissions(pluginId, BUNDLED_SOURCE)
  if (!required.every((permission) => requested.includes(permission))) return null
  const snapshot = getPluginPermissionSnapshot(BUNDLED_SOURCE, pluginId, requested)
  return missingPluginPermissions(snapshot, [...required]).length ? null : snapshot
}

export function isLauncherNativeRuntime(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
    && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}
