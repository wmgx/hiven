import { pluginRegistry } from '../../workspace/pluginRegistry'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { PluginDefinition, PluginPermission } from '../../workspace/pluginTypes'
import { getPluginPermissionSnapshot, missingPluginPermissions } from '../../workspace/pluginPermissions'
import { restartPluginBackground } from '../../workspace/pluginBackgroundManager'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { supportsDefaultParamRun } from './launcherParamShortcuts'
import type { LauncherMixedItem } from './LauncherMixedList'

export type PluginSurfaceTarget = {
  source: PluginSettingsSource
  pluginId: string
  surfaceId: string
  initialText?: string
}

export type LauncherItemPermissionFrame = {
  item: DomainLauncherItem
  source: PluginSettingsSource
  pluginId: string
  permissions: PluginPermission[]
  customizeParams: boolean
}

type LauncherControllerSelection = {
  selectItem(item: DomainLauncherItem, options?: { customizeParams?: boolean; objectBlockText?: string }): Promise<void> | void
}

export function resolvePluginSurfaceTarget(item: DomainLauncherItem): PluginSurfaceTarget | null {
  if (!item.systemKey.startsWith('plugin-surface:')) return null
  const parts = item.systemKey.split(':')
  const source = parts[1]
  const pluginId = parts[2]
  const surfaceId = parts[3]
  if (!isPluginSettingsSource(source) || !pluginId || !surfaceId) return null
  return { source, pluginId, surfaceId }
}

export function findMissingPluginItemPermissions(item: DomainLauncherItem): PluginPermission[] {
  if (!item.pluginId || !item.source) return []
  const requestedPermissions = pluginRegistry.getPluginPermissions(item.pluginId, item.source)
  if (requestedPermissions.length === 0) return []
  const permissions = getPluginPermissionSnapshot(item.source, item.pluginId, requestedPermissions)
  return missingPluginPermissions(permissions, requestedPermissions)
}

export function executeGlobalLauncherDomainItem({
  item,
  controller,
  customizeParams = false,
  objectBlockText,
}: {
  item: DomainLauncherItem
  controller: LauncherControllerSelection | null | undefined
  customizeParams?: boolean
  objectBlockText?: string
}) {
  if (!controller) {
    console.warn('[hiven] Cannot select domain launcher item before controller is ready:', item.systemKey)
    return
  }
  if (!customizeParams && !supportsDefaultParamRun(item)) {
    void controller.selectItem(item, { customizeParams: true, objectBlockText })
    return
  }
  void controller.selectItem(item, { customizeParams, objectBlockText })
}

export function buildItemPermissionFrame(item: DomainLauncherItem, customizeParams: boolean): LauncherItemPermissionFrame | null {
  const permissions = findMissingPluginItemPermissions(item)
  if (permissions.length === 0 || !item.pluginId || !item.source) return null
  return {
    item,
    source: item.source,
    pluginId: item.pluginId,
    permissions,
    customizeParams,
  }
}

export function grantGlobalLauncherItemPermissions(frame: LauncherItemPermissionFrame, grantPluginPermissions: (source: PluginSettingsSource, pluginId: string, permissions: PluginPermission[]) => void) {
  grantPluginPermissions(frame.source, frame.pluginId, frame.permissions)
  void restartPluginBackground(frame.pluginId, frame.source)
}

export function isWorkflowObjectLauncherItem(item?: LauncherMixedItem): boolean {
  return item?.kind === 'domain' && (item.domainItem.metadata?.kind === 'workflow-object' || item.domainItem.systemKey.startsWith('workflow:object:'))
}

export function getPluginSurfaceDefinition(target: PluginSurfaceTarget): {
  definition: PluginDefinition<unknown>
  surface: NonNullable<NonNullable<PluginDefinition<unknown>['ui']>['surfaces']>[number]
} | null {
  const definition = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
  const surface = definition?.ui?.surfaces?.find((candidate) => candidate.id === target.surfaceId)
  if (!definition || !surface) return null
  return { definition, surface }
}

function isPluginSettingsSource(value: string | undefined): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}
