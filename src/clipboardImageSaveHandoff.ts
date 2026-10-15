/** App composition: one explicit bundled image-save action, not a background-task API. */
import type { LauncherItem, PluginLauncherApi } from './workspace/launcher/types'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'
import { useAppStore } from './store'
import { pluginRegistry } from './workspace/pluginRegistry'
import { getPluginPermissionSnapshot, requirePluginPermissions, usePluginPermissionStore } from './workspace/pluginPermissions'
import { createPluginPrivateStorage } from './workspace/pluginStorage'
import { createPluginClipboardImageReader } from './workspace/pluginClipboardImageRead'
import { acquireLauncherNativeDialogFocus } from './workspace/launcherBlurGuard'
import { captureHudTarget, nativeToastRoutingAvailable } from './workspace/toastRouting'
import { showToast, dismissToast, type HudResult } from './workspace/toast'
import { t } from './i18n'
import { inspectRaster, decodeRaster } from './plugins/encode-decode/imageBase64'
import { saveClipboardPng } from './plugins/encode-decode/saveClipboardPng'

let busy = false
let lastNotice: string | undefined
const required = ['clipboard.read', 'clipboard.image', 'storage.blob', 'clipboard.write'] as const

export function withClipboardImageSave(
  api: PluginLauncherApi,
  item: LauncherItem | undefined,
  close: () => void | Promise<void>,
  restore: () => void | Promise<void>,
): PluginLauncherApi {
  if (!nativeToastRoutingAvailable() || item?.pluginId !== 'encode-decode' || item.source !== 'builtin' || item.systemKey !== 'plugin:encode-decode:launcher:open-image-save') return api
  // Capture at API creation: retained callbacks cannot acquire a newer launcher session.
  const definition = pluginRegistry.getPluginDefinition('encode-decode', 'production')
  if (!isCurrentBundledDefinition('encode-decode', item.source, definition)) return api
  const session = useAppStore.getState().globalLauncherSessionId
  const lifetime = item.pluginLifetime
  return { ...api, saveClipboardImageAsPng: async () => {
    if (busy || !useAppStore.getState().globalLauncherOpen || useAppStore.getState().globalLauncherSessionId !== session || lifetime?.active === false) return
    busy = true
    if (lastNotice) dismissToast(lastNotice)
    lastNotice = undefined
    const operation = crypto.randomUUID()
    const locale = useAppStore.getState().settings.locale
    let invalidated = false, committed = false
    const controller = new AbortController()
    const permissions = getPluginPermissionSnapshot('builtin', 'encode-decode', [...required])
    const current = () => !invalidated && useAppStore.getState().globalLauncherOpen && useAppStore.getState().globalLauncherSessionId === session && lifetime?.active !== false && isCurrentBundledDefinition('encode-decode', 'builtin', definition)
    const observe = () => {
      try {
        if (!current()) throw new Error('expired')
        requirePluginPermissions(getPluginPermissionSnapshot('builtin', 'encode-decode', [...required]), required)
      } catch { invalidated = true; controller.abort() }
    }
    const stops = [useAppStore.subscribe(observe), usePluginPermissionStore.subscribe(observe), pluginRegistry.subscribe(observe)]
    const releaseFocus = acquireLauncherNativeDialogFocus(current)
    let result: HudResult = 'image-save-failed'
    let target: string | undefined
    try {
      observe()
      if (!current()) return
      target = await captureHudTarget(operation)
      const storage = createPluginPrivateStorage('builtin', 'encode-decode', permissions, {
        capture: () => current,
        onCommit: () => { committed = true },
      })
      const read = createPluginClipboardImageReader('encode-decode', permissions, { source: 'builtin', isCurrent: current })
      if (!read) throw new Error('unsupported')
      const image = await read({ signal: controller.signal })
      const decoded = await decodeRaster(image.bytes, inspectRaster(image.bytes, image.contentType), controller.signal)
      const saved = await saveClipboardPng(storage, decoded.png, current)
      result = saved.status === 'cancelled' ? 'image-save-cancelled' : saved.pathCopied ? 'image-saved' : 'image-saved-path-failed'
    } catch {
      // Fixed outcome only. No native error, image, destination or clipboard path enters HUD.
      result = 'image-save-failed'
    } finally {
      const mayRestore = current()
      const shouldClose = result === 'image-saved' || result === 'image-saved-path-failed'
      for (const stop of stops) stop()
      // Keep dialog blur protection until the original launcher has either closed or
      // restored its input. A stale dialog must never revive or focus a newer session.
      try {
        if (mayRestore) {
          if (shouldClose) await close()
          else await restore()
        }
        // Cancellation is already visible in the chooser and leaves the launcher ready
        // to retry, so a second HUD is noise. Committed outcomes still report against
        // their captured target after a session replacement, without touching its UI.
        if (result !== 'image-save-cancelled' && (mayRestore || committed)) {
          const level = result === 'image-saved' ? 'success' : 'error'
          lastNotice = showToast(t(locale, `hud.result.${result}`), level, { durationMs: level === 'error' ? 6000 : 3500, hud: { operation, target, revision: 1, result } })
        }
      } finally { releaseFocus(); busy = false }
    }
  } }
}
