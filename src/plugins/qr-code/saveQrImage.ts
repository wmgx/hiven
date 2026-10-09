import type { PluginBlobSaveResult, PluginPrivateStorageApi } from '@hiven/plugin'
import { dataUrlToBytes } from './qrCore'

/** Freeze this generated image before opening a dialog, then remove only our temporary blob. */
export async function saveQrImage(storage: PluginPrivateStorageApi, dataUrl: string): Promise<PluginBlobSaveResult> {
  const ref = await storage.blob.put({
    bytes: dataUrlToBytes(dataUrl), contentType: 'image/png', extension: 'png',
  })
  try {
    return await storage.blob.savePng(ref.blobId, { suggestedFilename: 'qr-code.png' })
  } finally {
    // A revoked plugin may no longer delete its blob. Cleanup cannot turn a
    // completed save into a false failure, or cancellation into success.
    await storage.blob.delete(ref.blobId).catch(() => {})
  }
}
