/**
 * Plugin Paste API — Host Implementation
 *
 * Provides controlled paste semantics: write to clipboard, then attempt to simulate Cmd/Ctrl+V.
 * Known unavailable paste is rejected before changing the clipboard or window.
 * A failed native attempt falls back to "copied to clipboard".
 */

import type { PluginPasteApi, PluginPasteResult, PluginPermission, PluginPermissionSnapshot, PluginPrivateStorageApi } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'
import { writeClipboardImageBytes } from './pluginClipboard'
import { t } from '../i18n'
import { useAppStore } from '../store'
import { pasteAvailabilityMessageKey, readPasteAvailability } from './pasteAvailability'
import { cancelledPasteResult, captureLauncherPasteOwner, createPasteRecoveryAttempt, isPasteCancelled, type PasteRecoveryOwnerSource } from './pasteRecovery'
import { trackBehavior } from './telemetry'

const pasteMessage = (key: string) => t(useAppStore.getState().locale, `workspace.${key}`)
const isNativeCancellation = (error: unknown) => String(error).includes('HIVEN_PASTE_ATTEMPT_CANCELLED')

async function blockedPasteResult(): Promise<PluginPasteResult | undefined> {
  const key = pasteAvailabilityMessageKey(await readPasteAvailability())
  if (key) return { ok: false, fallback: 'none', message: t(useAppStore.getState().locale, key) }
}

async function writeTextToClipboard(text: string, isCurrent: () => boolean, signal: AbortSignal): Promise<void> {
  try {
    const { writeText } = await import('./nativeClipboard')
    if (!isCurrent()) return
    await writeText(text, signal)
  } catch (error) {
    if (!isCurrent()) throw error
    await navigator.clipboard.writeText(text)
  }
}

export function createPluginPaste(
  permissions?: PluginPermissionSnapshot,
  storage?: PluginPrivateStorageApi,
  options?: { keepOpen?: boolean; ownerSource?: PasteRecoveryOwnerSource },
): PluginPasteApi {
  const keepOpen = options?.keepOpen === true
  const deliver = async (
    required: PluginPermission[],
    write: (isCurrent: () => boolean, signal: AbortSignal) => Promise<PluginPasteResult | undefined>,
    fallbackKey: string,
  ): Promise<PluginPasteResult> => {
    if (permissions) requirePluginPermissions(permissions, required)
    // Capture before preflight, storage reads or any other await. An old host
    // callback must never acquire the session that replaced its own renderer.
    const launcherWindow = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('window') === 'launcher'
    const owner = options?.ownerSource ? options.ownerSource.capture()
      : launcherWindow ? captureLauncherPasteOwner() : undefined
    if ((options?.ownerSource || launcherWindow) && !owner) {
      trackBehavior('behavior:paste.result', { status: 'cancelled', reason: 'missing-owner', owned: false, keepOpen, current: false, hiding: false, expectedBlur: false })
      return cancelledPasteResult()
    }
    const attempt = createPasteRecoveryAttempt(owner, keepOpen)
    const finish = (result: PluginPasteResult, reason: 'none' | 'native-cancelled' = 'none'): PluginPasteResult => {
      const current = attempt.isCurrent()
      const completed = attempt.finish(result.ok) ? result : cancelledPasteResult()
      const cancelled = isPasteCancelled(completed)
      // Fixed outcomes and lifecycle flags only: never log clipboard bodies,
      // native tokens, target identity or raw native error messages.
      trackBehavior('behavior:paste.result', {
        status: cancelled ? 'cancelled' : completed.ok ? 'ok' : completed.fallback,
        reason: cancelled ? attempt.cancellationReason ?? (reason === 'native-cancelled' ? reason : 'owner-invalidated') : 'none',
        owned: !!owner, keepOpen, current,
        hiding: attempt.hiding, expectedBlur: attempt.expectedBlur,
      })
      return completed
    }
    try {
      const blocked = await blockedPasteResult()
      if (!attempt.isCurrent()) return finish(cancelledPasteResult())
      if (blocked) return finish(blocked)
      try {
        // Register before changing the clipboard. Native cancellation also
        // protects a hide invocation delayed by a throttled WebView.
        await attempt.prepare()
      } catch (error) {
        if (isNativeCancellation(error)) return finish(cancelledPasteResult(), 'native-cancelled')
        return finish({ ok: false, fallback: 'none', message: pasteMessage('paste.startFailed') })
      }
      if (!attempt.isCurrent()) return finish(cancelledPasteResult())
      const writeFailure = await write(attempt.isCurrent, attempt.signal)
      if (!attempt.isCurrent()) return finish(cancelledPasteResult())
      if (writeFailure) return finish(writeFailure)
      const { invoke } = await import('@tauri-apps/api/core')
      if (!attempt.startHandoff()) return finish(cancelledPasteResult())
      try {
        // Keep the original React tree alive throughout native hide/restore.
        // No JS timer or session close may run before delivery is confirmed.
        await invoke('hide_launcher_and_paste', { keepOpen, attemptId: attempt.attemptId })
        return finish({ ok: true })
      } catch (error) {
        if (isNativeCancellation(error)) return finish(cancelledPasteResult(), 'native-cancelled')
        const detail = error instanceof Error ? error.message : String(error)
        return finish({
          ok: false,
          fallback: 'copied',
          message: pasteMessage(detail.includes('Accessibility permission') ? 'paste.accessibilityRequired' : fallbackKey),
        })
      }
    } catch (error) {
      // Preserve permission/storage exceptions, but release their native owner.
      const current = attempt.finish(false)
      trackBehavior('behavior:paste.result', {
        status: current ? 'none' : 'cancelled',
        reason: current ? 'exception' : attempt.cancellationReason ?? 'owner-invalidated',
        owned: !!owner, keepOpen, current,
        hiding: attempt.hiding, expectedBlur: attempt.expectedBlur,
      })
      if (!current) return cancelledPasteResult()
      throw error
    }
  }

  return {
    pasteText: (text) => deliver(['clipboard.write', 'accessibility.paste'], async (isCurrent, signal) => {
      try {
        await writeTextToClipboard(text, isCurrent, signal)
      } catch {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.clipboardWriteFailed') }
      }
    }, 'paste.copied'),

    pasteImage: (blobId) => deliver(['clipboard.write', 'clipboard.image', 'storage.blob', 'accessibility.paste'], async (isCurrent, signal) => {
      if (!storage) return { ok: false, fallback: 'none', message: pasteMessage('paste.imageStorageRequired') }
      const bytes = await storage.blob.get(blobId)
      if (!isCurrent()) return cancelledPasteResult()
      if (!bytes) return { ok: false, fallback: 'none', message: pasteMessage('paste.imageUnavailable') }
      try {
        await writeClipboardImageBytes(bytes, signal)
      } catch {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.imageWriteFailed') }
      }
    }, 'paste.imageCopied'),

    pasteFiles: (paths) => deliver(['clipboard.write', 'clipboard.files', 'accessibility.paste'], async (isCurrent, signal) => {
      try {
        await writeTextToClipboard(paths.join('\n'), isCurrent, signal)
      } catch {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.filesWriteFailed') }
      }
    }, 'paste.filesCopied'),
  }
}
