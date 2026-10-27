/** App composition: plugin-declared "save the clipboard image" action, hosted as one explicit transaction. */
import type { LauncherItem, PluginLauncherApi } from '../workspace/launcher/types'
import { getPluginLauncherItemKey } from '../workspace/launcher/identity'
import { isCurrentBundledDefinition } from '../workspace/bundledPluginIdentity'
import { installRegisteredSurfaceShortcutHandler } from '../hotkeys/pluginSurfaceShortcuts'
import { useAppStore } from '../store'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { getPluginPermissionSnapshot, requirePluginPermissions, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createPluginClipboardImageReader } from '../workspace/pluginClipboardImageRead'
import { acquireLauncherNativeDialogFocus } from '../workspace/launcherBlurGuard'
import { captureHudTarget, nativeToastRoutingAvailable } from '../workspace/toastRouting'
import { dismissToast } from '../workspace/toast'
import { flash } from '../workspace/notify'

type ImageSaveResult = 'image-saved' | 'image-saved-path-failed' | 'image-save-failed' | 'image-save-cancelled'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from '../workspace/pluginSurfaceShortcuts'
import type { PluginClipboardImageSaveContribution } from '../workspace/pluginTypes'
import { t } from '../i18n'
import { BUNDLED_SOURCE, grantedPermissions, isLauncherNativeRuntime, listBundledSurfaceTasks, type BundledSurfaceTask } from './bundledSurfaces'

type Task = BundledSurfaceTask<PluginClipboardImageSaveContribution>

let busy = false
let lastNotice: string | undefined

type ImageSaveOwner = {
  current: () => boolean
  definition: object
  afterResult: (result: ImageSaveResult, current: boolean) => void | Promise<void>
  reportCommittedAfterInvalidation: boolean
  backgroundAction?: 'image-save-shortcut'
}

async function runClipboardImageSave(task: Task, owner: ImageSaveOwner): Promise<void> {
  if (busy || !owner.current()) return
  busy = true
  if (lastNotice) dismissToast(lastNotice)
  lastNotice = undefined
  const { pluginId, contribution } = task
  const required = contribution.permissions
  const operation = crypto.randomUUID()
  const locale = useAppStore.getState().settings.locale
  let invalidated = false, committed = false
  const controller = new AbortController()
  const permissions = getPluginPermissionSnapshot(BUNDLED_SOURCE, pluginId, [...required])
  const current = () => !invalidated && owner.current()
  const observe = () => {
    try {
      if (!current() || !isCurrentBundledDefinition(pluginId, BUNDLED_SOURCE, owner.definition)) throw new Error('expired')
      requirePluginPermissions(getPluginPermissionSnapshot(BUNDLED_SOURCE, pluginId, [...required]), required)
    } catch { invalidated = true; controller.abort() }
  }
  const stops = [useAppStore.subscribe(observe), usePluginPermissionStore.subscribe(observe), pluginRegistry.subscribe(observe)]
  let result: ImageSaveResult = 'image-save-failed'
  let target: string | undefined
  try {
    observe()
    if (!current()) return
    target = await captureHudTarget(operation, undefined, owner.backgroundAction)
    if (!current()) return
    const storage = createPluginPrivateStorage(BUNDLED_SOURCE, pluginId, permissions, {
      capture: () => current,
      onCommit: () => { committed = true },
    })
    const read = createPluginClipboardImageReader(pluginId, permissions, { source: BUNDLED_SOURCE, isCurrent: current })
    if (!read) throw new Error('unsupported')
    const image = await read({ signal: controller.signal })
    const saved = await contribution.run({ image, storage, signal: controller.signal, isCurrent: current })
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
        lastNotice = flash({ level, message: t(locale, `hud.result.${result}`) }, { operation, target, revision: 1 })
      }
    } finally { busy = false }
  }
}

/** Exact bundled shortcut entry. The caller owns binding/permission validity. */
export async function saveClipboardImageFromShortcut(task: Task, current: () => boolean): Promise<void> {
  await runClipboardImageSave(task, {
    current,
    definition: task.definition,
    afterResult: () => undefined,
    reportCommittedAfterInvalidation: false,
    backgroundAction: 'image-save-shortcut',
  })
}

function findLauncherTask(item: LauncherItem): Task | undefined {
  return listBundledSurfaceTasks<PluginClipboardImageSaveContribution>((surface) => surface.clipboardImageSave)
    .find((task) => task.pluginId === item.pluginId
      && item.systemKey === getPluginLauncherItemKey(task.pluginId, task.contribution.launcherItemId))
}

export function withClipboardImageSave(
  api: PluginLauncherApi,
  item: LauncherItem | undefined,
  close: () => void | Promise<void>,
  restore: () => void | Promise<void>,
): PluginLauncherApi {
  if (!nativeToastRoutingAvailable() || !item || item.source !== 'builtin') return api
  const task = findLauncherTask(item)
  // Capture at API creation: retained callbacks cannot acquire a newer launcher session.
  const definition = task && pluginRegistry.getPluginDefinition(task.pluginId, 'production')
  if (!task || !definition || !isCurrentBundledDefinition(task.pluginId, item.source, definition)) return api
  const session = useAppStore.getState().globalLauncherSessionId
  const lifetime = item.pluginLifetime
  return { ...api, saveClipboardImageAsPng: async () => {
    const current = () => useAppStore.getState().globalLauncherOpen && useAppStore.getState().globalLauncherSessionId === session
      && lifetime?.active !== false && isCurrentBundledDefinition(task.pluginId, BUNDLED_SOURCE, definition)
    const releaseFocus = acquireLauncherNativeDialogFocus(current)
    try {
      await runClipboardImageSave(task, {
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

/** Install the shortcut handlers of every bundled plugin that declares a clipboard image save action. */
export function installClipboardImageSaveShortcuts(): () => void {
  if (!isLauncherNativeRuntime()) return () => {}
  let alive = true
  const releases = new Map<string, { definition: object; release: () => void }>()

  const reconcile = () => {
    if (!alive) return
    const tasks = new Map(listBundledSurfaceTasks<PluginClipboardImageSaveContribution>((surface) => surface.clipboardImageSave)
      .map((task) => [`${task.pluginId}:${task.surfaceId}`, task]))
    for (const [key, entry] of releases) {
      if (tasks.get(key)?.definition === entry.definition) continue
      entry.release()
      releases.delete(key)
    }
    for (const [key, task] of tasks) {
      if (releases.has(key)) continue
      const target = { source: BUNDLED_SOURCE, pluginId: task.pluginId, surfaceId: task.surfaceId }
      const shortcutKey = pluginSurfaceShortcutKey(target)
      const ready = () => {
        const live = pluginRegistry.getPluginDefinition(task.pluginId, 'production')
        return live === task.definition && isCurrentBundledDefinition(task.pluginId, BUNDLED_SOURCE, live)
          && grantedPermissions(task.pluginId, task.contribution.permissions) !== null
      }
      const current = () => {
        const shortcut = usePluginSurfaceShortcutStore.getState().shortcuts[shortcutKey]
        return alive && shortcut?.enabled === true && shortcut.registrationStatus === 'registered' && ready()
      }
      let release: () => void
      try {
        release = installRegisteredSurfaceShortcutHandler(target, async () => {
          if (!ready() || !current()) return true
          await saveClipboardImageFromShortcut(task, current)
          return true
        })
      } catch { continue }
      releases.set(key, { definition: task.definition, release })
    }
  }

  const stopRegistry = pluginRegistry.subscribe(reconcile)
  reconcile()
  return () => {
    if (!alive) return
    alive = false
    stopRegistry()
    for (const entry of releases.values()) entry.release()
    releases.clear()
  }
}
