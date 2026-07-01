/**
 * Plugin Clipboard API — Host Implementation
 *
 * Provides clipboard read/write and a polling-based watch mechanism.
 * Uses @tauri-apps/plugin-clipboard-manager when available, falls back to navigator.clipboard.
 */

import type {
  ClipboardChange,
  ClipboardWatchOptions,
  PluginClipboardApi,
  PluginPermission,
  PluginPermissionSnapshot,
  PluginPrivateStorageApi,
} from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'

type ClipboardImage = {
  bytes: Uint8Array
  contentType: string
  width?: number
  height?: number
}

type ClipboardImageSnapshot = {
  hashBytes: Uint8Array
  contentType: string
  width?: number
  height?: number
  toStoredImage: () => Promise<ClipboardImage>
}

async function readClipboardText(): Promise<string> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return (await readText()) ?? ''
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.warn('[plugin-clipboard] write failed:', error)
    }
  }
}

async function writeClipboardImage(bytes: Uint8Array): Promise<void> {
  try {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager')
    try {
      const { Image } = await import('@tauri-apps/api/image')
      const image = await Image.fromBytes(bytes)
      await writeImage(image)
    } catch {
      await writeImage(bytes)
    }
    return
  } catch {
    // Fall through to browser ClipboardItem support.
  }

  const ClipboardItemCtor = globalThis.ClipboardItem
  if (!navigator.clipboard?.write || !ClipboardItemCtor) {
    throw new Error('Image clipboard write is not supported in this environment')
  }
  const blob = new Blob([bytes], { type: 'image/png' })
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })])
}

async function readClipboardSourceApp(): Promise<string | undefined> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const appName = await invoke<string | null>('current_foreground_app_name')
    return appName?.trim() || undefined
  } catch {
    return undefined
  }
}

type NativeClipboardContent =
  | { kind: 'files'; paths: string[] }
  | { kind: 'image' }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }

async function readNativeClipboardContent(): Promise<NativeClipboardContent> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<NativeClipboardContent>('read_clipboard_content')
  } catch {
    // Fallback: read text via old path
    const text = await readClipboardText()
    if (text) return { kind: 'text', text }
    return { kind: 'empty' }
  }
}

async function readNativeChangeCount(): Promise<number | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<number | null>('clipboard_change_count')
  } catch {
    return null
  }
}

async function readClipboardImageSnapshot(): Promise<ClipboardImageSnapshot | null> {
  try {
    const { readImage } = await import('@tauri-apps/plugin-clipboard-manager')
    const image = await readImage()
    const [rgba, size] = await Promise.all([image.rgba(), image.size()])
    return {
      hashBytes: rgba,
      contentType: 'image/png',
      width: size.width,
      height: size.height,
      toStoredImage: async () => ({
        bytes: await encodeRgbaAsPng(rgba, size.width, size.height),
        contentType: 'image/png',
        width: size.width,
        height: size.height,
      }),
    }
  } catch {
    // Fall through to browser clipboard read support.
  }

  if (!navigator.clipboard?.read) return null
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'))
      if (!imageType) continue
      const blob = await item.getType(imageType)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return {
        hashBytes: bytes,
        contentType: imageType,
        toStoredImage: async () => ({ bytes, contentType: imageType }),
      }
    }
  } catch {
    return null
  }
  return null
}

async function encodeRgbaAsPng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    throw new Error('Cannot encode clipboard image without DOM canvas support')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Cannot encode clipboard image without canvas context')
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result)
      else reject(new Error('Failed to encode clipboard image'))
    }, 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

function hashString(text: string): string {
  // Simple FNV-1a hash for change detection
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 2166136261
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function fileNameForPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() ?? path
}

function watchPermissions(options: ClipboardWatchOptions): PluginPermission[] {
  const required: PluginPermission[] = ['clipboard.watch']
  if (options.text !== false) required.push('clipboard.read')
  if (options.images) required.push('clipboard.image')
  if (options.files) required.push('clipboard.files')
  return required
}

export function createPluginClipboard(
  pluginId: string,
  permissions?: PluginPermissionSnapshot,
  storage?: PluginPrivateStorageApi,
): PluginClipboardApi {
  void pluginId
  const requirePermissions = (required: PluginPermission[]) => {
    if (permissions) requirePluginPermissions(permissions, required)
  }

  return {
    async readText(): Promise<string> {
      requirePermissions(['clipboard.read'])
      return readClipboardText()
    },

    async writeText(text: string): Promise<void> {
      requirePermissions(['clipboard.write'])
      await writeClipboardText(text)
    },

    async writeImage(blobId: string): Promise<void> {
      requirePermissions(['clipboard.write', 'clipboard.image', 'storage.blob'])
      if (!storage) throw new Error('Image clipboard write requires plugin blob storage')
      const bytes = await storage.blob.get(blobId)
      if (!bytes) throw new Error(`Blob not found: ${blobId}`)
      await writeClipboardImage(bytes)
    },

    async writeFiles(paths: string[]): Promise<void> {
      requirePermissions(['clipboard.write', 'clipboard.files'])
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('write_clipboard_files', { paths })
      } catch {
        // Fallback: write as newline-separated text
        await writeClipboardText(paths.join('\n'))
      }
    },

    async watch(
      options: ClipboardWatchOptions,
      onChange: (change: ClipboardChange) => void,
    ): Promise<() => void> {
      requirePermissions(watchPermissions(options))
      const pollInterval = options.pollIntervalMs ?? 1000
      const imagePollInterval = options.imagePollIntervalMs ?? Math.max(pollInterval, 3000)
      let lastTextHash = ''
      let lastImageHash = ''
      let lastImagePollAt = 0
      let lastChangeCount: number | null = null
      let polling = false
      let stopped = false

      // Initialize: seed hashes from current content to avoid double-fire on start
      try {
        lastChangeCount = await readNativeChangeCount()
        const initial = await readNativeClipboardContent()
        if (initial.kind === 'text') lastTextHash = hashString(`text:${initial.text}`)
        else if (initial.kind === 'files') lastTextHash = hashString(`files:${initial.paths.join('\n')}`)
        if (initial.kind !== 'image' && options.images && storage) {
          const img = await readClipboardImageSnapshot()
          if (img) lastImageHash = hashBytes(img.hashBytes)
        }
      } catch {
        // Ignore initialization errors
      }

      const intervalId = setInterval(async () => {
        if (stopped || polling) return
        polling = true

        try {
          // Cheap check: has clipboard changed at all?
          const changeCount = await readNativeChangeCount()
          if (changeCount !== null && changeCount === lastChangeCount) return
          lastChangeCount = changeCount

          const content = await readNativeClipboardContent()

          switch (content.kind) {
            case 'files': {
              if (!options.files) break
              const pathsKey = content.paths.join('\n')
              const currentHash = hashString(`files:${pathsKey}`)
              if (currentHash === lastTextHash) break
              lastTextHash = currentHash
              const sourceApp = await readClipboardSourceApp()
              onChange({
                kind: 'files',
                paths: content.paths,
                fileNames: content.paths.map(fileNameForPath),
                hash: currentHash,
                changedAt: Date.now(),
                sourceApp,
              })
              break
            }

            case 'image': {
              if (!options.images || !storage) break
              const now = Date.now()
              if (now - lastImagePollAt < imagePollInterval) break
              lastImagePollAt = now
              const image = await readClipboardImageSnapshot()
              if (!image) break
              const imageHash = hashBytes(image.hashBytes)
              if (imageHash === lastImageHash) break
              const storedImage = await image.toStoredImage()
              if (options.maxImageBytes && storedImage.bytes.length > options.maxImageBytes) break
              const blobRef = await storage.blob.put({
                bytes: storedImage.bytes,
                contentType: storedImage.contentType,
              })
              const sourceApp = await readClipboardSourceApp()
              lastImageHash = imageHash
              onChange({
                kind: 'image',
                blobId: blobRef.blobId,
                previewBlobId: blobRef.blobId,
                contentType: blobRef.contentType,
                byteSize: blobRef.byteSize,
                width: storedImage.width,
                height: storedImage.height,
                hash: imageHash,
                changedAt: Date.now(),
                sourceApp,
              })
              break
            }

            case 'text': {
              if (options.text === false) break
              const byteSize = new TextEncoder().encode(content.text).length
              if (options.maxTextBytes && byteSize > options.maxTextBytes) break
              const currentHash = hashString(`text:${content.text}`)
              if (currentHash === lastTextHash) break
              lastTextHash = currentHash
              const sourceApp = await readClipboardSourceApp()
              onChange({
                kind: 'text',
                text: content.text,
                byteSize,
                hash: currentHash,
                changedAt: Date.now(),
                sourceApp,
              })
              break
            }

            case 'empty':
              break
          }
        } catch (error) {
          console.warn('[plugin-clipboard] watch poll error:', error)
        } finally {
          polling = false
        }
      }, pollInterval)

      // Return unsubscribe function
      return () => {
        stopped = true
        clearInterval(intervalId)
      }
    },
  }
}
