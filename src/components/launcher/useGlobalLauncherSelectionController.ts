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
  type PluginSurfaceTarget,
} from './GlobalLauncherSelection'
import {
  getPluginSurfaceShortcutPresentation,
  showPluginSurfaceWindow,
} from '../../workspace/windowManager/pluginSurfaceWindows'
import { detectClipboardFilePath } from '../../launcher/clipboard/clipboardSnapshot'

type UseGlobalLauncherSelectionControllerInput = {
  controllerRef: RefObject<LauncherController | null>
  standaloneLauncher: boolean
  overlay: boolean
  restoreFocus: () => void
  setOpen: (open: boolean) => void
  clearPluginSurfaceTool: () => void
  openPluginSurface: (target: PluginSurfaceTarget) => void | Promise<void>
  grantPluginPermissions: (pluginId: string, permissions: string[]) => void
  focusSearchInputAfterBack: () => void
  objectBlockText?: string
}

/** Resolve Object Block / clipboard text into surface initialText (load file when payload is a path). */
async function resolveSurfaceInitialText(raw: string | undefined): Promise<string | undefined> {
  if (!raw?.trim()) return undefined
  const text = raw
  const filePath = detectClipboardFilePath(text)
  if (!filePath) return text
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string>('read_file', { path: filePath.path })
  } catch (error) {
    console.warn('[hiven] Failed to read clipboard file path for plugin surface:', filePath.path, error)
    // Fall back to path string so surface can still show / allow manual open
    return text
  }
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
        void (async () => {
          const initialText = await resolveSurfaceInitialText(objectBlockText)
          const target: PluginSurfaceTarget = {
            ...pluginSurfaceTarget,
            initialText,
          }
          // Surfaces that declare window presentation (e.g. clipboard history)
          // must open as an independent window — never stack on top of the
          // current launcher surface (text-diff, settings, …).
          if (getPluginSurfaceShortcutPresentation(target) === 'window') {
            // In Tauri open an independent window; in browser fall through to launcher shell.
            const isTauri = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
            if (isTauri) {
              void showPluginSurfaceWindow(target)
              return
            }
          }
          clearPluginSurfaceTool()
          await openPluginSurface(target)
        })()
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
  }, [clearPluginSurfaceTool, executeDomainItem, objectBlockText, openPluginSurface])

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
