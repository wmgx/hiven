import { useCallback, useState, type RefObject } from 'react'
import type { LauncherController } from '../../workspace/launcher/controller'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import type { GlobalLauncherItem } from './GlobalLauncherItems'
import { finishPinnedLauncherSelection } from './GlobalLauncherClose'
import {
  buildItemPermissionFrame,
  executeGlobalLauncherDomainItem,
  grantGlobalLauncherItemPermissions,
  resolvePluginSurfaceTarget,
  type LauncherItemPermissionFrame,
} from './GlobalLauncherSelection'

type UseGlobalLauncherSelectionControllerInput = {
  controllerRef: RefObject<LauncherController | null>
  standaloneLauncher: boolean
  overlay: boolean
  openPinnedAction: (pinnedId: string) => void
  restoreFocus: () => void
  setOpen: (open: boolean) => void
  clearPluginSurfaceTool: () => void
  openPluginSurface: (target: ReturnType<typeof resolvePluginSurfaceTarget>) => void | Promise<void>
  grantPluginPermissions: (pluginId: string, permissions: string[]) => void
  focusSearchInputAfterBack: () => void
}

export function useGlobalLauncherSelectionController({
  controllerRef,
  standaloneLauncher,
  overlay,
  openPinnedAction,
  restoreFocus,
  setOpen,
  clearPluginSurfaceTool,
  openPluginSurface,
  grantPluginPermissions,
  focusSearchInputAfterBack,
}: UseGlobalLauncherSelectionControllerInput) {
  const [itemPermissionFrame, setItemPermissionFrame] = useState<LauncherItemPermissionFrame | null>(null)

  const executeDomainItem = useCallback((item: DomainLauncherItem, customizeParams = false) => {
    executeGlobalLauncherDomainItem({
      item,
      controller: controllerRef.current,
      customizeParams,
    })
  }, [controllerRef])

  const selectItem = useCallback((item: GlobalLauncherItem | undefined, customizeParams = false) => {
    if (!item) return

    if (item.kind === 'domain') {
      const pluginSurfaceTarget = resolvePluginSurfaceTarget(item.domainItem)
      if (pluginSurfaceTarget) {
        clearPluginSurfaceTool()
        void openPluginSurface(pluginSurfaceTarget)
        return
      }

      const permissionFrame = buildItemPermissionFrame(item.domainItem, customizeParams)
      if (permissionFrame) {
        setItemPermissionFrame(permissionFrame)
        return
      }

      executeDomainItem(item.domainItem, customizeParams)
      return
    }

    if (item.kind === 'pinned') {
      void finishPinnedLauncherSelection({
        pinnedId: item.id,
        standaloneLauncher,
        overlay,
        openPinnedAction,
        restoreFocus,
        setOpen,
      })
    }
  }, [clearPluginSurfaceTool, executeDomainItem, openPinnedAction, openPluginSurface, overlay, restoreFocus, setOpen, standaloneLauncher])

  const grantItemPermissionsAndRun = useCallback(() => {
    if (!itemPermissionFrame) return
    grantGlobalLauncherItemPermissions(itemPermissionFrame, grantPluginPermissions)
    const item = itemPermissionFrame.item
    const customizeParams = itemPermissionFrame.customizeParams
    setItemPermissionFrame(null)
    executeDomainItem(item, customizeParams)
  }, [executeDomainItem, grantPluginPermissions, itemPermissionFrame])

  const cancelItemPermissionPrompt = useCallback(() => {
    setItemPermissionFrame(null)
    focusSearchInputAfterBack()
  }, [focusSearchInputAfterBack])

  return {
    itemPermissionFrame,
    setItemPermissionFrame,
    selectItem,
    grantItemPermissionsAndRun,
    cancelItemPermissionPrompt,
  }
}
