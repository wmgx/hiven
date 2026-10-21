import type { PluginBlobSaveResult, PluginPrivateStorageApi } from '@hiven/plugin'

/** Freeze only this explicit image; native owns the destination and copies its path after writing. */
export async function saveClipboardPng(
  storage: PluginPrivateStorageApi,
  png: Uint8Array,
  current: () => boolean,
): Promise<PluginBlobSaveResult> {
  if (!current()) return { status: 'cancelled' }
  const ref = await storage.blob.put({ bytes: png, contentType: 'image/png', extension: 'png' })
  try {
    if (!current()) return { status: 'cancelled' }
    return await storage.blob.savePng(ref.blobId, {
      suggestedFilename: `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      copyPathToClipboard: true,
    })
  } finally {
    // Cleanup cannot turn a completed save or cancellation into a false failure.
    await storage.blob.delete(ref.blobId).catch(() => {})
  }
}
