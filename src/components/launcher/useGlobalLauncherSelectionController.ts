import { useCallback, useState, type RefObject } from 'react'
import type { LauncherController } from '../../workspace/launcher/controller'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import type { GlobalLauncherItem } from './GlobalLauncherItems'
import {
  buildItemPermissionFrame,
  executeGlobalLauncherDomainItem,
  grantGlobalLauncherItemPermissions,
  resolvePluginSurfaceTarget,
  type LauncherItemPermissionFrame,
} from './GlobalLauncherSelection'
import {
  getPluginSurfaceShortcutPresentation,
  showPluginSurfaceWindow,
} from '../../workspace/windowManager/pluginSurfaceWindows'

type UseGlobalLauncherSelectionControllerInput = {
  controllerRef: RefObject<LauncherController | null>
  standaloneLauncher: boolean
  overlay: boolean
  restoreFocus: () => void
  setOpen: (open: boolean) => void
  clearPluginSurfaceTool: () => void
  openPluginSurface: (target: ReturnType<typeof resolvePluginSurfaceTarget>) => void | Promise<void>
  grantPluginPermissions: (pluginId: string, permissions: string[]) => void
  focusSearchInputAfterBack: () => void
  objectBlockText?: string
}

export function useGlobalLauncherSelectionController({
  controllerRef,
  standaloneLauncher,
  overlay,
  restoreFocus,
  setOpen,
  clearPluginSurfaceTool,
  openPluginSurface,
  grantPluginPermissions,
  focusSearchInputAfterBack,
  objectBlockText,
}: UseGlobalLauncherSelectionControllerInput) {
  const [itemPermissionFrame, setItemPermissionFrame] = useState<LauncherItemPermissionFrame | null>(null)

  const executeDomainItem = useCallback((item: DomainLauncherItem, customizeParams = false) => {
    executeGlobalLauncherDomainItem({
      item,
      controller: controllerRef.current,
      customizeParams,
      objectBlockText,
    })
  }, [controllerRef, objectBlockText])

  const selectItem = useCallback((item: GlobalLauncherItem | undefined, customizeParams = false) => {
    if (!item) return

    if (item.kind === 'domain') {
      const pluginSurfaceTarget = resolvePluginSurfaceTarget(item.domainItem)
      if (pluginSurfaceTarget) {
        // Surfaces that declare window presentation (e.g. clipboard history)
        // must open as an independent window — never stack on top of the
        // current launcher surface (text-diff, settings, …).
        if (getPluginSurfaceShortcutPresentation(pluginSurfaceTarget) === 'window') {
          void showPluginSurfaceWindow(pluginSurfaceTarget)
          return
        }
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
  }, [clearPluginSurfaceTool, executeDomainItem, openPluginSurface])

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
