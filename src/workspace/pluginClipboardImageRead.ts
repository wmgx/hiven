import type { PluginClipboardApi, PluginPermission, PluginPermissionSnapshot } from './pluginTypes'
import type { PluginSettingsSource } from './pluginSettingsStore'
import { getPluginPermissionSnapshot, requirePluginPermissions } from './pluginPermissions'
import { pluginRegistry } from './pluginRegistry'
import { resolvePluginSettingsSource } from './launcher/pluginSource'
import { isTauriClipboardRuntime, readImage } from './nativeClipboard'
import { withImageHandle } from './nativeImageHandle'

/** Host-only lifetime. A retained API must never attach itself to a replacement surface. */
export type PluginClipboardImageReadOwner = {
  source: PluginSettingsSource
  isCurrent: () => boolean
}

const REQUIRED_PERMISSIONS = ['clipboard.read', 'clipboard.image'] as const
const MAX_IMAGE_DIMENSION = 8192
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024
const MAX_RGBA_BYTES = MAX_IMAGE_PIXELS * 4
const MAX_PNG_BYTES = 10 * 1024 * 1024

function readError(name: string): Error {
  return Object.assign(new Error(`Clipboard image read: ${name}`), { name })
}

function isNativeImageReadRuntime(): boolean {
  return isTauriClipboardRuntime() && !window.__HIVEN_WEB_NATIVE_BRIDGE__
}

/** Shared with an explicit image paste's optional text/Data URL fallback. */
export function createPluginClipboardReadGuard(
  pluginId: string,
  permissions: PluginPermissionSnapshot | undefined,
  owner: PluginClipboardImageReadOwner | undefined,
  required: readonly PluginPermission[],
): (() => void) | undefined {
  if (!owner) return undefined
  const lifetime = pluginRegistry.getPluginLifetime(pluginId, owner.source)
  let invalidated: Error | undefined
  return () => {
    if (invalidated) throw invalidated
    if (!owner.isCurrent() || !lifetime.active || pluginRegistry.getPluginLifetime(pluginId, owner.source) !== lifetime ||
      resolvePluginSettingsSource(pluginId, owner.source === 'dev' ? 'dev' : 'production') !== owner.source) {
      invalidated = readError('AbortError')
      throw invalidated
    }
    const requested = pluginRegistry.getPluginPermissions(pluginId, owner.source)
    try {
      if (required.some((permission) => !requested.includes(permission))) throw new Error('Undeclared permission')
      if (permissions) requirePluginPermissions(permissions, required)
      requirePluginPermissions(getPluginPermissionSnapshot(owner.source, pluginId, requested), required)
    } catch {
      invalidated = readError('NotAllowedError')
      throw invalidated
    }
  }
}

/** A foreground one-shot read; intentionally independent of History's watch policy. */
export function createPluginClipboardImageReader(
  pluginId: string,
  permissions?: PluginPermissionSnapshot,
  owner?: PluginClipboardImageReadOwner,
): PluginClipboardApi['readImage'] {
  if (!owner || !isNativeImageReadRuntime()) return undefined
  const requireOwner = createPluginClipboardReadGuard(pluginId, permissions, owner, REQUIRED_PERMISSIONS)!

  return async (options) => {
    const requireCurrent = () => {
      if (options?.signal?.aborted) throw readError('AbortError')
      requireOwner()
      if (!isNativeImageReadRuntime()) throw readError('NotReadableError')
    }

    try {
      requireCurrent()
      const pixels = await withImageHandle(await readImage(requireCurrent), async (image) => {
        requireCurrent()
        const size = await image.size()
        requireCurrent()
        const { width, height } = size
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
          width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
          throw readError('DataError')
        }
        const expectedBytes = width * height * 4
        const rgba = await image.rgba()
        requireCurrent()
        if (!(rgba instanceof Uint8Array) || rgba.byteLength !== expectedBytes || rgba.byteLength > MAX_RGBA_BYTES) {
          throw readError('DataError')
        }
        return { rgba, width, height }
      })
      requireCurrent()
      const { rgba, width, height } = pixels
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      try {
        const context = canvas.getContext('2d')
        if (!context) throw readError('NotReadableError')
        context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => result ? resolve(result) : reject(readError('NotReadableError')), 'image/png')
        })
        requireCurrent()
        if (blob.size <= 0 || blob.size > MAX_PNG_BYTES || blob.type !== 'image/png') throw readError('DataError')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        requireCurrent()
        if (bytes.byteLength !== blob.size) throw readError('DataError')
        return { bytes, contentType: 'image/png' as const, width, height }
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
    } catch (error) {
      // Recheck after a rejected native promise as well: stale actions must not
      // turn into a retry/fallback after the owner or its grant was removed.
      requireCurrent()
      if (error instanceof Error && ['AbortError', 'NotAllowedError', 'DataError', 'NotReadableError'].includes(error.name)) throw error
      throw readError('NotReadableError')
    }
  }
}
