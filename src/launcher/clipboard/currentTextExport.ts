import type { LauncherObjectBlock } from './objectBlock'
import { canEditMaterialText } from './currentMaterial'
import { captureCurrentTextDeliveryScope } from './currentTextDelivery'
import { invoke } from '@tauri-apps/api/core'

export const CURRENT_TEXT_EXPORT_ACTION = 'save-current-text'
export const CURRENT_TEXT_EXPORT_MAX_BYTES = 1024 * 1024

/** Explicit empty material is a valid zero-byte export. Never read a preview or a path. */
export function getCurrentTextExportPayload(block: LauncherObjectBlock | null): string | null {
  return canEditMaterialText(block) ? block!.payloadText! : null
}

export function canExportCurrentText(params: {
  block: LauncherObjectBlock | null
  nativeDesktop: boolean
  standaloneLauncher: boolean
}): boolean {
  return params.nativeDesktop && params.standaloneLauncher && getCurrentTextExportPayload(params.block) !== null
}

/** Query epochs also invalidate a row when the user types and then restores the old query. */
export function captureCurrentTextExportScope(params: Parameters<typeof captureCurrentTextDeliveryScope>[0] & {
  getQueryGeneration: () => number
  getLifetime: () => number | undefined
}) {
  const root = captureCurrentTextDeliveryScope(params)
  const queryGeneration = params.getQueryGeneration()
  const lifetime = params.getLifetime()
  const isCurrentLifetime = () => lifetime !== undefined && params.getLifetime() === lifetime
  return {
    isCurrentLifetime,
    isCurrent: () => isCurrentLifetime() && params.getQueryGeneration() === queryGeneration && root.isCurrent(),
  }
}

export const CURRENT_TEXT_EXPORT_ERROR_KEYS = {
  TEXT_EXPORT_TOO_LARGE: 'palette.currentTextExportTooLarge',
  TEXT_EXPORT_UNAVAILABLE: 'palette.currentTextExportUnavailable',
  TEXT_EXPORT_INVALID_LEASE: 'palette.currentTextExportExpired',
  TEXT_EXPORT_BUSY: 'palette.currentTextExportBusy',
  TEXT_EXPORT_WRITE_FAILED: 'palette.currentTextExportFailed',
} as const
export type CurrentTextExportError = keyof typeof CURRENT_TEXT_EXPORT_ERROR_KEYS
export type CurrentTextExportResult = { status: 'saved' | 'cancelled' } | { status: 'error'; code: CurrentTextExportError }
export type CurrentTextExportLabels = { dialogTitle: string }
type PreparedExport = { status: 'prepared'; exportId: number } | { status: 'cancelled' }
type NativeTextExport = {
  getSession: () => Promise<number>
  prepare: (text: string, labels: CurrentTextExportLabels, expectedSession: number) => Promise<PreparedExport>
  commit: (exportId: number) => Promise<{ status: 'saved' }>
  discard: (exportId: number) => Promise<void>
}

export const nativeCurrentTextExport: NativeTextExport = {
  getSession: async () => (await invoke<{ session: number; revision: number }>('get_launcher_window_resize_session')).session,
  prepare: (text, labels, expectedSession) => invoke<PreparedExport>('prepare_host_text_export', { text, ...labels, expectedSession }),
  commit: (exportId) => invoke<{ status: 'saved' }>('commit_host_text_export', { exportId }),
  discard: (exportId) => invoke<void>('discard_host_text_export', { exportId }),
}

/** One chooser at a time. Native alone owns its selected path and bounded text ticket. */
export function createCurrentTextExport(native: NativeTextExport = nativeCurrentTextExport) {
  let busy = false
  const run = async (params: {
    block: LauncherObjectBlock
    isCurrent: () => boolean
    labels: CurrentTextExportLabels
    acquireFocusLease: () => () => void
  }): Promise<CurrentTextExportResult | null> => {
    // Capture the complete immutable payload before opening the asynchronous chooser.
    const text = getCurrentTextExportPayload(params.block)
    if (busy || text === null || !params.isCurrent()) return null
    if (new TextEncoder().encode(text).byteLength > CURRENT_TEXT_EXPORT_MAX_BYTES) {
      return { status: 'error', code: 'TEXT_EXPORT_TOO_LARGE' }
    }
    busy = true
    let exportId: number | undefined
    try {
      const expectedSession = await native.getSession()
      if (!params.isCurrent()) return null
      let prepared: PreparedExport
      const releaseFocus = params.acquireFocusLease()
      try {
        prepared = await native.prepare(text, params.labels, expectedSession)
      } finally {
        // Losing ownership cannot release a chooser that is still on screen.
        releaseFocus()
      }
      if (prepared.status === 'cancelled') return params.isCurrent() ? { status: 'cancelled' } : null
      exportId = prepared.exportId
      if (!params.isCurrent()) return null
      // Commit dispatch is the point of no return. Later invalidation suppresses
      // feedback only; it cannot retract an already dispatched native file write.
      const result = await native.commit(exportId)
      exportId = undefined
      return params.isCurrent() ? result : null
    } catch (error) {
      if (!params.isCurrent()) return null
      const message = error instanceof Error ? error.message : error
      const code = typeof message === 'string' && Object.hasOwn(CURRENT_TEXT_EXPORT_ERROR_KEYS, message)
        ? message as CurrentTextExportError : 'TEXT_EXPORT_WRITE_FAILED'
      return { status: 'error', code }
    } finally {
      // Never invalidate all tickets: a stale completion must not revoke newer work.
      if (exportId !== undefined) await native.discard(exportId).catch(() => undefined)
      busy = false
    }
  }
  return Object.assign(run, { isBusy: () => busy })
}
