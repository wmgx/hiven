import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { PluginSurfaceSaveTextErrorName, PluginSurfaceSaveTextOptions, PluginSurfaceSaveTextResult } from './pluginTypes'
import { isNativeDesktopRuntime } from './webNativeBridge'

export const SURFACE_TEXT_SAVE_MAX_BYTES = 10 * 1024 * 1024

/** Host-only identities and tickets. None of these are exported by the plugin SDK. */
type NativeOwner = { ownerId: string; ownerToken: number }
type PreparedText = { status: 'prepared'; exportId: number } | { status: 'cancelled' }
type SurfaceOwner = { isCurrent: () => boolean; subscribeInvalidation: (listener: () => void) => () => void }
type NativeSurfaceTextSave = {
  isSupported: () => boolean
  register: (ownerId: string) => Promise<NativeOwner>
  revoke: (owner: NativeOwner) => Promise<void>
  prepare: (owner: NativeOwner, snapshot: string, dialogTitle: string, suggestedFilename?: string) => Promise<PreparedText>
  commit: (owner: NativeOwner, exportId: number) => Promise<{ status: 'saved' }>
  discard: (owner: NativeOwner, exportId: number) => Promise<void>
}

export const nativeSurfaceTextSave: NativeSurfaceTextSave = {
  isSupported: isNativeDesktopRuntime,
  register: async (ownerId) => {
    const expectedSession = getCurrentWindow().label === 'launcher'
      ? (await invoke<{ session: number }>('get_launcher_window_resize_session')).session : undefined
    const { ownerToken } = await invoke<{ ownerToken: number }>('register_host_surface_text_export_owner', { ownerId, expectedSession })
    return { ownerId, ownerToken }
  },
  revoke: (owner) => invoke<void>('revoke_host_surface_text_export_owner', owner),
  prepare: (owner, text, dialogTitle, suggestedFilename) => invoke<PreparedText>('prepare_host_surface_text_export', { ...owner, text, dialogTitle, suggestedFilename }),
  commit: (owner, exportId) => invoke<{ status: 'saved' }>('commit_host_surface_text_export', { ...owner, exportId }),
  discard: (owner, exportId) => invoke<void>('discard_host_surface_text_export', { ...owner, exportId }),
}

function saveError(name: PluginSurfaceSaveTextErrorName): Error {
  // Plugins map names to their own localized UI. Never expose native error text.
  return Object.assign(new Error(name), { name })
}

const nativeErrors: Record<string, PluginSurfaceSaveTextErrorName> = {
  TEXT_EXPORT_TOO_LARGE: 'TextTooLargeError',
  TEXT_EXPORT_INVALID_FILENAME: 'InvalidFilenameError',
  TEXT_EXPORT_INVALID_LEASE: 'AbortError',
  TEXT_EXPORT_BUSY: 'BusyError',
  TEXT_EXPORT_UNAVAILABLE: 'SaveUnavailableError',
  TEXT_EXPORT_WRITE_FAILED: 'SaveFailedError',
}

function validateSnapshot(snapshot: string, filename: string | undefined): void {
  if (typeof snapshot !== 'string') throw saveError('TypeError')
  if (snapshot.length > SURFACE_TEXT_SAVE_MAX_BYTES || new TextEncoder().encode(snapshot).byteLength > SURFACE_TEXT_SAVE_MAX_BYTES) {
    throw saveError('TextTooLargeError')
  }
  if (filename === undefined) return
  if (typeof filename !== 'string' || !filename.trim() || filename === '.' || filename === '..'
    || new TextEncoder().encode(filename).byteLength > 255 || /[<>:"/\\|?*\p{Cc}]/u.test(filename)
    || /[. ]$/.test(filename) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
    throw saveError('InvalidFilenameError')
  }
}

/** A narrow surface adapter over the existing native host_text_export kernel. */
export function createPluginSurfaceTextSaver(native: NativeSurfaceTextSave = nativeSurfaceTextSave) {
  // Keep this controller for the renderer's entire mount, even across target changes.
  // An invalidated chooser still occupies its slot until its native dialog settles.
  let busy = false
  return async (snapshot: string, options: PluginSurfaceSaveTextOptions | undefined, context: {
    owner: SurfaceOwner
    dialogTitle: string
    acquireFocusLease: () => () => void
  }): Promise<PluginSurfaceSaveTextResult> => {
    if (!native.isSupported()) throw saveError('NotSupportedError')
    const signal = options?.signal
    let invalidated = signal?.aborted === true || !context.owner.isCurrent()
    const isCurrent = () => !invalidated && !signal?.aborted && context.owner.isCurrent()
    const requireCurrent = () => { if (!isCurrent()) throw saveError('AbortError') }
    requireCurrent()
    if (busy) throw saveError('BusyError')
    // Capture primitive values before any asynchronous registration or chooser work.
    const suggestedFilename = options?.suggestedFilename
    validateSnapshot(snapshot, suggestedFilename)
    busy = true
    let owner: NativeOwner | undefined
    let exportId: number | undefined
    let commitDispatched = false
    let revocation: Promise<void> | undefined
    const revoke = () => {
      if (owner && !revocation) revocation = native.revoke(owner).catch(() => undefined)
      return revocation
    }
    const interrupt = () => {
      invalidated = true
      // Native revocation may still win before commit is accepted. Once consumed,
      // the writer is independent of this owner and returns the real write result.
      void revoke()
    }
    const stopOwner = context.owner.subscribeInvalidation(interrupt)
    signal?.addEventListener('abort', interrupt, { once: true })
    try {
      requireCurrent()
      owner = await native.register(crypto.randomUUID())
      // Late registration is cleaned in finally, including when already aborted.
      requireCurrent()
      let prepared: PreparedText
      const releaseFocus = context.acquireFocusLease()
      try {
        requireCurrent()
        prepared = await native.prepare(owner, snapshot, context.dialogTitle, suggestedFilename)
      } finally {
        // Physical chooser lifetime, not promise/owner lifetime, owns dialog focus.
        releaseFocus()
      }
      if (prepared.status === 'prepared') exportId = prepared.exportId
      requireCurrent()
      if (prepared.status === 'cancelled') return { status: 'cancelled' }
      if (!Number.isSafeInteger(exportId) || exportId! < 0) throw saveError('SaveUnavailableError')
      // No await between the final owner check and dispatch. Native atomically
      // validates owner + lease on consume. Later invalidation cannot retract an
      // accepted write, and must not turn its actual result into cancellation.
      requireCurrent()
      commitDispatched = true
      const result = await native.commit(owner, exportId!)
      if (result.status !== 'saved') throw saveError('SaveFailedError')
      exportId = undefined
      return { status: 'saved' }
    } catch (error) {
      if (!commitDispatched && !isCurrent()) throw saveError('AbortError')
      if (error instanceof Error && error.message === error.name
        && ['AbortError', 'SaveUnavailableError', 'SaveFailedError'].includes(error.name)) throw error
      const message = error instanceof Error ? error.message : error
      throw saveError(typeof message === 'string' && Object.hasOwn(nativeErrors, message) ? nativeErrors[message] : 'SaveFailedError')
    } finally {
      stopOwner()
      signal?.removeEventListener('abort', interrupt)
      if (owner && exportId !== undefined) await native.discard(owner, exportId).catch(() => undefined)
      await revoke()
      busy = false
    }
  }
}
