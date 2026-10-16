import { useAppStore } from '../../store'
import { pickLocale, translate } from '../../i18n'
import { showToast } from '../toast'
import { useQuickEditorStore } from './quickEditorStore'
import type {
  QuickEditorOverwriteOptions,
  QuickEditorPaneId,
  QuickEditorVersionRestoreRequest,
  QuickEditorVersionRestoreResult,
} from './quickEditorTypes'
import {
  isQuickEditorDetachedWindow,
  isQuickEditorWindowOpen,
  QUICK_EDITOR_WINDOW_LABEL,
  showQuickEditorWindow,
} from '../windowManager/quickEditorWindow'
import { LAUNCHER_WINDOW_LABEL } from '../windowManager/windowLabels'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { isNativeDesktopRuntime } from '../webNativeBridge'
import { requestQuickEditorOverwrite, type QuickEditorOverwriteLifecycle } from './quickEditorOverwriteHandoff'
import {
  requestQuickEditorPaneWrite,
  type QuickEditorPaneWriteLifecycle,
  type QuickEditorPaneWriteReceipt,
} from './quickEditorPaneWriteHandoff'

export const QUICK_EDITOR_CREATE_PANE_EVENT = 'hiven://quick-editor-create-pane'

export type QuickEditorPaneRequest = {
  text?: string
  language?: string
  direction?: 'left' | 'right' | 'top' | 'bottom'
}

export type OverwriteQuickEditorResult = {
  paneId: QuickEditorPaneId
  historyCount: number
}

type QueuedPaneWrite = {
  paneId: QuickEditorPaneId
  text: string
  expectedRevision: number
  lifecycle?: QuickEditorPaneWriteLifecycle
  resolve: (updated: boolean) => void
}

type PaneWriteQueue = { running: boolean; pending?: QueuedPaneWrite }
const paneWriteQueues = new Map<QuickEditorPaneId, PaneWriteQueue>()

function readDurablePane(paneId: QuickEditorPaneId): { revision: number; text: string } | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem('hiven-quick-editor') ?? 'null') as {
      state?: { panes?: Record<string, { revision?: unknown; text?: unknown }> }
    } | null
    const pane = parsed?.state?.panes?.[paneId]
    const revision = pane?.revision === undefined ? 0 : pane.revision
    if (!Number.isSafeInteger(revision) || (revision as number) < 0 || typeof pane?.text !== 'string') return undefined
    return { revision: revision as number, text: pane.text }
  } catch {
    return undefined
  }
}

function paneWriteIsCurrent(lifecycle?: QuickEditorPaneWriteLifecycle): boolean {
  return !lifecycle?.signal?.aborted && lifecycle?.isCurrent?.() !== false
}

function queuedPaneWrite(queue: PaneWriteQueue): QueuedPaneWrite | undefined {
  return queue.pending
}

function normalizeDirection(direction: QuickEditorPaneRequest['direction']): 'right' | 'bottom' {
  return direction === 'top' || direction === 'bottom' ? 'bottom' : 'right'
}

/**
 * Summon Quick Editor as an independent window (same presentation as clipboard).
 *
 * Desktop (Tauri): always open/focus the detached quick-editor window.
 * If the editor was hosted inside the launcher, leave that host first so only
 * one editor host is active.
 * Browser / non-Tauri: fall back to the launcher host surface.
 */
export async function showQuickEditorSurface(): Promise<void> {
  if (!isNativeDesktopRuntime()) {
    await requestOpenLauncherHostSurface('quick-editor')
    return
  }

  const state = useAppStore.getState()
  if (state.launcherHostSurfaceTarget === 'quick-editor') {
    // Single-instance rule: detach leaves the launcher host empty; put it away.
    const wasLauncherOpen = state.globalLauncherOpen
    state.setGlobalLauncherOpen(false)
    if (wasLauncherOpen) {
      try {
        const { hideLauncherWindow } = await import('../windowManager/launcherWindow')
        await hideLauncherWindow()
      } catch (error) {
        console.warn('[hiven] Failed to hide launcher while opening quick editor window:', error)
      }
    }
  }

  await showQuickEditorWindow()
}

export async function createQuickEditorPane(input: QuickEditorPaneRequest = {}): Promise<QuickEditorPaneId | undefined> {
  if (await isQuickEditorWindowOpen({ throwOnError: true })) {
    await showQuickEditorWindow()
    if (isNativeDesktopRuntime()) {
      const { emit } = await import('@tauri-apps/api/event')
      await emit(QUICK_EDITOR_CREATE_PANE_EVENT, input)
    }
    return undefined
  }

  await useQuickEditorStore.persist.rehydrate()
  useAppStore.getState().openLauncherHostSurface('quick-editor')
  return useQuickEditorStore.getState().createPane({
    direction: normalizeDirection(input.direction),
    text: input.text,
    language: input.language,
  })
}

export function applyQuickEditorPaneRequest(input: QuickEditorPaneRequest): QuickEditorPaneId {
  return useQuickEditorStore.getState().createPane({
    direction: normalizeDirection(input.direction),
    text: input.text,
    language: input.language,
  })
}

export function isQuickEditorPaneRequest(value: unknown): value is QuickEditorPaneRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as QuickEditorPaneRequest
  return (
    (request.text === undefined || typeof request.text === 'string') &&
    (request.language === undefined || typeof request.language === 'string') &&
    (
      request.direction === undefined ||
      request.direction === 'left' ||
      request.direction === 'right' ||
      request.direction === 'top' ||
      request.direction === 'bottom'
    )
  )
}

/**
 * Write pane text for Diff ↔ quick-editor binding.
 * Native multi-window callers deliver only to the active renderer owner. The
 * sender must not persist its own possibly stale full-store snapshot first.
 */
async function deliverNativePaneWrite(input: QueuedPaneWrite): Promise<QuickEditorPaneWriteReceipt> {
  const detachedOpen = await isQuickEditorWindowOpen({ throwOnError: true })
  return await requestQuickEditorPaneWrite(
    { paneId: input.paneId, text: input.text, expectedRevision: input.expectedRevision },
    detachedOpen ? QUICK_EDITOR_WINDOW_LABEL : LAUNCHER_WINDOW_LABEL,
    input.lifecycle,
  )
}

async function drainPaneWriteQueue(paneId: QuickEditorPaneId, queue: PaneWriteQueue): Promise<void> {
  if (queue.running) return
  queue.running = true
  try {
    while (queue.pending) {
      const current = queue.pending
      queue.pending = undefined
      if (!paneWriteIsCurrent(current.lifecycle)) {
        current.resolve(false)
        continue
      }

      let receipt: QuickEditorPaneWriteReceipt | undefined
      try {
        receipt = await deliverNativePaneWrite(current)
      } catch (error) {
        if (paneWriteIsCurrent(current.lifecycle)) {
          console.warn('[hiven] Quick editor pane write was not acknowledged:', error)
        }
      }
      current.resolve(receipt?.updated === true)

      // Calls made while this write was in flight saw the old durable revision.
      // Advance only when the acknowledged owner write is still the durable head;
      // an intervening Quick Editor edit/restore makes the queued input stale.
      const next = queuedPaneWrite(queue)
      if (receipt?.updated && Number.isSafeInteger(receipt.revision)
        && next?.expectedRevision === current.expectedRevision) {
        const durable = readDurablePane(paneId)
        if (durable && durable.revision === receipt.revision && durable.text === current.text) {
          next.expectedRevision = receipt.revision as number
        }
      }
    }
  } finally {
    queue.running = false
    if (queue.pending) void drainPaneWriteQueue(paneId, queue)
    else if (paneWriteQueues.get(paneId) === queue) paneWriteQueues.delete(paneId)
  }
}

function enqueueNativePaneWrite(
  paneId: QuickEditorPaneId,
  text: string,
  expectedRevision: number,
  lifecycle?: QuickEditorPaneWriteLifecycle,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let queue = paneWriteQueues.get(paneId)
    if (!queue) {
      queue = { running: false }
      paneWriteQueues.set(paneId, queue)
    }
    // Keep at most one not-yet-delivered change. A superseded edit is not
    // acknowledged as written; the latest change will follow the in-flight one.
    queue.pending?.resolve(false)
    queue.pending = { paneId, text, expectedRevision, lifecycle, resolve }
    void drainPaneWriteQueue(paneId, queue)
  })
}

export function setQuickEditorPaneText(
  paneId: QuickEditorPaneId,
  text: string,
  lifecycle?: QuickEditorPaneWriteLifecycle,
): Promise<boolean> {
  if (!paneWriteIsCurrent(lifecycle)) return Promise.resolve(false)
  if (isQuickEditorDetachedWindow()) {
    lifecycle?.onCommit?.()
    return Promise.resolve(useQuickEditorStore.getState().setPaneText(paneId, text))
  }

  if (!isNativeDesktopRuntime()) {
    return Promise.resolve(useQuickEditorStore.persist.rehydrate()).then(() => {
      if (!paneWriteIsCurrent(lifecycle)) return false
      lifecycle?.onCommit?.()
      return useQuickEditorStore.getState().setPaneText(paneId, text)
    }).catch((error: unknown) => {
      console.warn('[hiven] Quick editor pane write failed:', error)
      return false
    })
  }

  const durable = readDurablePane(paneId)
  if (!durable) return Promise.resolve(false)
  return enqueueNativePaneWrite(paneId, text, durable.revision, lifecycle)
}

/**
 * Overwrite active Quick Editor content (Object Block / tool destination).
 * Archives the pre-overwrite content into external version history only —
 * user typing never creates history entries. Then open/focus the editor window.
 */
export async function overwriteQuickEditorText(
  text: string,
  options: QuickEditorOverwriteOptions = {},
  lifecycle?: QuickEditorOverwriteLifecycle,
): Promise<OverwriteQuickEditorResult> {
  const detached = new URLSearchParams(window.location.search).get('window') === 'quick-editor'
  let result: OverwriteQuickEditorResult
  if (isNativeDesktopRuntime() && !detached) {
    // The destination hydrates its own saved draft when newly opened, or reads its
    // live draft when already open. Never archive the sender's stale store.
    try { result = await requestQuickEditorOverwrite(text, options, showQuickEditorSurface, lifecycle) }
    catch { throw new Error(translate(useAppStore.getState().locale, 'quickEditor', 'overwriteFailed')) }
  } else {
    if (lifecycle?.signal?.aborted || lifecycle?.isCurrent?.() === false) {
      throw new Error(translate(useAppStore.getState().locale, 'quickEditor', 'overwriteFailed'))
    }
    lifecycle?.onCommit?.()
    const paneId = useQuickEditorStore.getState().overwriteActiveText(text, options)
    result = { paneId, historyCount: useQuickEditorStore.getState().externalVersionHistory.length }
    if (!detached) useAppStore.getState().openLauncherHostSurface('quick-editor')
  }
  const { historyCount } = result
  const locale = useAppStore.getState().locale
  showToast(
    historyCount > 0
      ? pickLocale(
          locale,
          `已覆盖到快捷编辑器（${historyCount} 个历史版本）`,
          `Overwritten in Quick Editor (${historyCount} version${historyCount === 1 ? '' : 's'})`,
        )
      : pickLocale(locale, '已覆盖到快捷编辑器', 'Overwritten in Quick Editor'),
    'success',
    3500,
  )

  return result
}

/**
 * Confirm a previewed external-overwrite version. The destination archives its
 * current draft in the same durable commit before restoring the old text.
 */
export async function restoreQuickEditorExternalVersion(
  request: QuickEditorVersionRestoreRequest,
): Promise<QuickEditorVersionRestoreResult> {
  const result = useQuickEditorStore.getState().confirmExternalVersionRestore(request)
  if (result !== 'restored') return result

  const locale = useAppStore.getState().locale
  showToast(
    pickLocale(locale, '已恢复历史版本', 'Restored historical version'),
    'info',
    2500,
  )
  return result
}
