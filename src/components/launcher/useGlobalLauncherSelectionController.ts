import { useCallback, useState, type RefObject } from 'react'
import type { LauncherController } from '../../workspace/launcher/controller'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import type { GlobalLauncherItem } from './GlobalLauncherItems'
import {
  buildItemPermissionFrame,
  executeGlobalLauncherDomainItem,
  getPluginSurfaceDefinition,
  grantGlobalLauncherItemPermissions,
  resolvePluginSurfaceTarget,
  type LauncherItemPermissionFrame,
  type PluginSurfaceTarget,
} from './GlobalLauncherSelection'
import { detectClipboardFilePath } from '../../launcher/clipboard/clipboardSnapshot'
import { suppressStandaloneLauncherBlur } from '../../workspace/launcherBlurGuard'
import {
  getPluginSurfaceShortcutPresentation,
  showPluginSurfaceWindow,
} from '../../workspace/windowManager/pluginSurfaceWindows'
import { showToast } from '../../workspace/toast'
import {
  TelemetryEvents,
  measureLatency,
  trackBehavior,
} from '../../workspace/telemetry'

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
  standaloneLauncher: _omit_standaloneLauncher,
  overlay: _omit_overlay,
  restoreFocus: _omit_restoreFocus,
  setOpen: _omit_setOpen,
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
      // Controller.selectItem records general item_select; here only surface-routing.
      const pluginSurfaceTarget = resolvePluginSurfaceTarget(item.domainItem)
      if (pluginSurfaceTarget) {
        void (async () => {
          if (!getPluginSurfaceDefinition(pluginSurfaceTarget)) {
            showToast(
              `Surface unavailable: ${pluginSurfaceTarget.pluginId}/${pluginSurfaceTarget.surfaceId}`,
              'error',
            )
            return
          }
          const initialText = await resolveSurfaceInitialText(objectBlockText)
          const target: PluginSurfaceTarget = {
            ...pluginSurfaceTarget,
            initialText,
          }
          // Window-presentation surfaces (clipboard history) open as independent
          // windows. Suppress + smart blur keep Global Launcher open alongside them.
          if (getPluginSurfaceShortcutPresentation(target) === 'window') {
            const isTauri = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
            if (isTauri) {
              trackBehavior(TelemetryEvents.surfaceWindowOpen, {
                pluginId: target.pluginId,
                surfaceId: target.surfaceId,
              })
              // Cover focus handoff before the companion window is focused/visible.
              suppressStandaloneLauncherBlur(2_000)
              void showPluginSurfaceWindow(target)
              return
            }
          }
          clearPluginSurfaceTool()
          trackBehavior(TelemetryEvents.surfaceOpen, {
            pluginId: target.pluginId,
            surfaceId: target.surfaceId,
            hasInitialText: Boolean(target.initialText?.trim()),
          })
          await measureLatency(TelemetryEvents.surfaceOpenLatency, () => openPluginSurface(target), {
            pluginId: target.pluginId,
            surfaceId: target.surfaceId,
          })
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
    grantGlobalLauncherItemPermissions(itemPermissionFrame, grantPluginPermissions as never)
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
