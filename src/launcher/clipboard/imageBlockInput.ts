import type { PluginToolImageInput } from '../../workspace/launcher/types'
import { getPluginPermissionSnapshot } from '../../workspace/pluginPermissions'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import type { ObjectBlockImagePayload } from './objectBlock'

function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * Read-only image handed to an image-input tool. Clipboard images carry their
 * PNG inline; history images live in clipboard-history blob storage.
 */
export function imageBlockInput(image: ObjectBlockImagePayload): PluginToolImageInput {
  return {
    contentType: image.contentType,
    width: image.width,
    height: image.height,
    async readBytes() {
      if (image.dataUrl) return dataUrlBytes(image.dataUrl)
      if (!image.blobId) throw new Error('ImagePayloadMissing')
      const permissions = getPluginPermissionSnapshot('builtin', 'clipboard-history', ['storage.private', 'storage.blob'])
      const bytes = await createPluginPrivateStorage('builtin', 'clipboard-history', permissions).blob.get(image.blobId)
      if (!bytes) throw new Error('ImagePayloadMissing')
      return bytes
    },
  }
}
