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

async function writeClipboardText(text: string): Promise<void> {
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

function extractFilePaths(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return []
  const looksLikePath = (line: string) =>
    line.startsWith('/') ||
    line.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(line) ||
    line.startsWith('\\\\')

  return lines.every(looksLikePath) ? lines : []
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
      await writeClipboardText(paths.join('\n'))
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
      let polling = false
      let stopped = false

      // Initialize with current clipboard content
      try {
        const lastText = await readClipboardText()
        lastTextHash = hashString(lastText)
      } catch {
        // Ignore initialization errors
      }
      if (options.images && storage) {
        try {
          const image = await readClipboardImageSnapshot()
          if (image) lastImageHash = hashBytes(image.hashBytes)
        } catch {
          // Ignore initialization errors
        }
      }

      const intervalId = setInterval(async () => {
        if (stopped || polling) return
        polling = true

        try {
          const now = Date.now()
          if (options.images && storage && now - lastImagePollAt >= imagePollInterval) {
            lastImagePollAt = now
            const image = await readClipboardImageSnapshot()
            if (image) {
              const imageHash = hashBytes(image.hashBytes)
              if (imageHash !== lastImageHash) {
                const storedImage = await image.toStoredImage()
                if (!options.maxImageBytes || storedImage.bytes.length <= options.maxImageBytes) {
                  const blobRef = await storage.blob.put({ bytes: storedImage.bytes, contentType: storedImage.contentType })
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
                }
              }
            }
          }

          if (options.text !== false || options.files) {
            const currentText = await readClipboardText()
            if (!currentText) return

            const filePaths = options.files ? extractFilePaths(currentText) : []
            const currentHash = hashString(`${filePaths.length > 0 ? 'files' : 'text'}:${currentText}`)
            if (currentHash === lastTextHash) return

            // Check size limits
            const byteSize = new TextEncoder().encode(currentText).length
            if (options.maxTextBytes && byteSize > options.maxTextBytes) return

            lastTextHash = currentHash

            if (filePaths.length > 0) {
              const sourceApp = await readClipboardSourceApp()
              onChange({
                kind: 'files',
                paths: filePaths,
                fileNames: filePaths.map(fileNameForPath),
                hash: currentHash,
                changedAt: Date.now(),
                sourceApp,
              })
              return
            }

            if (options.text === false) return

            const change: ClipboardChange = {
              kind: 'text',
              text: currentText,
              byteSize,
              hash: currentHash,
              changedAt: Date.now(),
              sourceApp: await readClipboardSourceApp(),
            }
            onChange(change)
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
