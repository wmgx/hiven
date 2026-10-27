import type { PluginSurfaceHostApi } from '@hiven/plugin'

/** Put exported PNG bytes on the clipboard; throws so the shared output actions report failure. */
export async function copyPng(host: PluginSurfaceHostApi, bytes: Uint8Array): Promise<void> {
  const blob = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
  try {
    await host.clipboard.writeImage(blob.blobId)
  } finally {
    try { await host.storage.blob.delete(blob.blobId) } catch { /* Delivery result takes priority over cleanup. */ }
  }
}
