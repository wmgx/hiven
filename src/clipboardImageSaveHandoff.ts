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

type ImageSaveOwner = {
  current: () => boolean
  definition: object
  afterResult: (result: HudResult, current: boolean) => void | Promise<void>
  reportCommittedAfterInvalidation: boolean
  backgroundAction?: 'image-save-shortcut'
}

async function runClipboardImageSave(owner: ImageSaveOwner): Promise<void> {
  if (busy || !owner.current()) return
  busy = true
  if (lastNotice) dismissToast(lastNotice)
  lastNotice = undefined
  const operation = crypto.randomUUID()
  const locale = useAppStore.getState().settings.locale
  let invalidated = false, committed = false
  const controller = new AbortController()
  const permissions = getPluginPermissionSnapshot('builtin', 'encode-decode', [...required])
  const current = () => !invalidated && owner.current()
  const observe = () => {
    try {
      if (!current() || !isCurrentBundledDefinition('encode-decode', 'builtin', owner.definition)) throw new Error('expired')
      requirePluginPermissions(getPluginPermissionSnapshot('builtin', 'encode-decode', [...required]), required)
    } catch { invalidated = true; controller.abort() }
  }
  const stops = [useAppStore.subscribe(observe), usePluginPermissionStore.subscribe(observe), pluginRegistry.subscribe(observe)]
  let result: HudResult = 'image-save-failed'
  let target: string | undefined
  try {
    observe()
    if (!current()) return
    target = await captureHudTarget(operation, undefined, owner.backgroundAction)
    if (!current()) return
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
    const mayFinish = current()
    for (const stop of stops) stop()
    try {
      await owner.afterResult(result, mayFinish)
      // Cancellation is already visible in the chooser; a second HUD is noise.
      // A shortcut owner that disappeared never leaves a late status behind.
      if (result !== 'image-save-cancelled' && (mayFinish || (committed && owner.reportCommittedAfterInvalidation))) {
        const level = result === 'image-saved' ? 'success' : 'error'
        lastNotice = showToast(t(locale, `hud.result.${result}`), level, { durationMs: level === 'error' ? 6000 : 3500, hud: { operation, target, revision: 1, result } })
      }
    } finally { busy = false }
  }
}

/** Exact bundled shortcut entry. The caller owns binding/permission validity. */
export async function saveClipboardImageFromShortcut(current: () => boolean, definition: object): Promise<void> {
  await runClipboardImageSave({
    current,
    definition,
    afterResult: () => undefined,
    reportCommittedAfterInvalidation: false,
    backgroundAction: 'image-save-shortcut',
  })
}

export function withClipboardImageSave(
  api: PluginLauncherApi,
  item: LauncherItem | undefined,
  close: () => void | Promise<void>,
  restore: () => void | Promise<void>,
): PluginLauncherApi {
  if (!nativeToastRoutingAvailable() || item?.pluginId !== 'encode-decode' || item.source !== 'builtin' || item.systemKey !== 'plugin:encode-decode:launcher:open-image-save') return api
  // Capture at API creation: retained callbacks cannot acquire a newer launcher session.
  const definition = pluginRegistry.getPluginDefinition('encode-decode', 'production')
  if (!definition || !isCurrentBundledDefinition('encode-decode', item.source, definition)) return api
  const session = useAppStore.getState().globalLauncherSessionId
  const lifetime = item.pluginLifetime
  return { ...api, saveClipboardImageAsPng: async () => {
    const current = () => useAppStore.getState().globalLauncherOpen && useAppStore.getState().globalLauncherSessionId === session
      && lifetime?.active !== false && isCurrentBundledDefinition('encode-decode', 'builtin', definition)
    const releaseFocus = acquireLauncherNativeDialogFocus(current)
    try {
      await runClipboardImageSave({
        current,
        definition,
        reportCommittedAfterInvalidation: true,
        afterResult: async (result, mayRestore) => {
          if (!mayRestore) return
          if (result === 'image-saved' || result === 'image-saved-path-failed') await close()
          else await restore()
        },
      })
    } finally { releaseFocus() }
  } }
}
