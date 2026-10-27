import en from './locales/en.json'
import zh from './locales/zh.json'
/**
 * First-party Image Tools plugin: shrink, crop, redact a clipboard/file image, or save a
 * clipboard screenshot as PNG. Includes raster image and Base64 conversion.
 */
import { definePlugin } from '@hiven/plugin'
import { ImageToolsSurface } from './ImageToolsSurface'
import { saveClipboardImageAsPng } from './saveClipboardImage'
import './style.css'

const SHELL = {
  defaultWidth: 860,
  defaultHeight: 640,
  minWidth: 640,
  minHeight: 420,
  closeOnBlur: false,
  resizable: true,
}

const ROUTES = [
  { id: 'image-base64', title: 'image.title', aliases: ['image base64', '图片 Base64'] },
  { id: 'image-resize', title: 'resize.title', aliases: ['resize image', 'shrink image', 'image width', '图片缩小', '调整图片尺寸', '图片宽度', '图片等比缩小'] },
  { id: 'image-crop', title: 'crop.title', aliases: ['crop image', 'crop screenshot', '图片裁剪', '裁剪图片', '裁剪截图'] },
  { id: 'image-redact', title: 'redact.title', aliases: ['redact screenshot', 'redact image', 'hide image text', '截图遮挡', '图片遮挡', '图片打码'] },
  { id: 'image-save', title: 'image.saveRouteTitle', aliases: ['save screenshot', 'save clipboard image', 'screenshot png', '截图保存文件', '截图存为文件', '保存截图', '保存剪贴板图片'] },
] as const

export const imageToolsPlugin = definePlugin({
  ui: {
    surfaces: ROUTES.map((route) => ({
      id: route.id,
      kind: 'custom-view' as const,
      title: en[route.title],
      titleI18n: { zh: zh[route.title] },
      component: ImageToolsSurface,
      entry: { launcher: false, shortcutBindable: route.id === 'image-save' },
      clipboardImageSave: route.id === 'image-save'
        ? {
            launcherItemId: 'open-image-save',
            permissions: ['clipboard.read', 'clipboard.image', 'storage.blob', 'clipboard.write'] as const,
            run: saveClipboardImageAsPng,
          }
        : undefined,
      shell: SHELL,
    })),
  },
  launcher: {
    items: ROUTES.map((route) => ({
      id: `open-${route.id}`,
      display: { title: route.title, icon: 'Image', aliases: [...route.aliases] },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      async execute(execution) {
        if (route.id === 'image-save' && execution.api.saveClipboardImageAsPng) {
          await execution.api.saveClipboardImageAsPng()
          return { ok: true as const, keepOpen: true }
        }
        execution.api.openSurface(route.id, route.id === 'image-base64' ? { initialText: execution.input?.text } : undefined)
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
})

export default imageToolsPlugin
