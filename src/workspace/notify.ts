/**
 * Global notifications (host SDK `notify`): a transient flash and at most one
 * persistent status, shown in the desktop HUD when no hiven window is focused.
 * Text must be localized status copy with counts only — never clipboard,
 * selection or other user content. Call only from a user action or a session
 * the user started; plugins must not push in the background.
 */
import { dismissToast, showToast, type HudReceipt } from './toast'

export type NotifyLevel = 'success' | 'error' | 'info'
export type NotifyFlash = { level: NotifyLevel; message: string }
export type NotifyStatus = { id: string; title: string; detail?: string; progress?: { completed: number; total: number } }
export type NotifyApi = {
  flash(notice: NotifyFlash): void
  /** Same id updates the visible status instead of adding another one. */
  status(notice: NotifyStatus): void
  end(id: string): void
}

const FLASH_MS = 1200
const ERROR_FLASH_MS = 3000
const MAX_CHARS = 80
const statusToastIds = new Map<string, string>()
let statusGeneration = 0

/** One line within the HUD bound; longer copy is shortened, not rejected. */
function statusText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS - 1)}…` : line
}

export function flash(notice: NotifyFlash, receipt?: HudReceipt): string | undefined {
  const message = statusText(notice.message)
  if (!message) return undefined
  return showToast(message, notice.level, {
    durationMs: notice.level === 'error' ? ERROR_FLASH_MS : FLASH_MS,
    hud: receipt,
    notify: { slot: 'flash' },
  })
}

export function status(notice: NotifyStatus, receipt?: HudReceipt): void {
  const title = statusText(notice.title)
  if (!notice.id || !title) return
  // An ended id is tombstoned natively, so a restarted session needs a fresh toast id.
  const toastId = statusToastIds.get(notice.id) ?? `status-${++statusGeneration}-${Date.now().toString(36)}`
  statusToastIds.set(notice.id, toastId)
  const detail = notice.detail === undefined ? undefined : statusText(notice.detail) || undefined
  showToast(title, 'info', { id: toastId, persistent: true, progress: notice.progress, hud: receipt, notify: { slot: 'status', detail } })
}

export function end(id: string): void {
  const toastId = statusToastIds.get(id)
  if (!toastId) return
  statusToastIds.delete(id)
  dismissToast(toastId)
}

export const hostNotify: NotifyApi = {
  flash: (notice) => { flash(notice) },
  status: (notice) => status(notice),
  end,
}
