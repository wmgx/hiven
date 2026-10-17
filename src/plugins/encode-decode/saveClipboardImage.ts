import type { PluginBlobSaveResult, PluginClipboardImageSaveContext } from '@hiven/plugin'
import { decodeRaster, inspectRaster } from './imageBase64'
import { saveClipboardPng } from './saveClipboardPng'

/** Convert the explicit clipboard image to PNG and hand it to the native save chooser. */
export async function saveClipboardImageAsPng(context: PluginClipboardImageSaveContext): Promise<PluginBlobSaveResult> {
  const { image, storage, signal, isCurrent } = context
  const decoded = await decodeRaster(image.bytes, inspectRaster(image.bytes, image.contentType), signal)
  return saveClipboardPng(storage, decoded.png, isCurrent)
}
