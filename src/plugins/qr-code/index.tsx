/**
 * First-party QR Code plugin: generate from text, decode from images.
 * Two launcher surfaces — not text tools — so decode never collects text and
 * generate shows the image instead of a Data URL.
 */

import { definePlugin } from '@hiven/plugin'
import { QrSurface } from './QrSurface'
import { isImageDataUrl } from './qrCore'

function isHttpUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim())
}

const QR_SHELL = {
  defaultWidth: 860,
  defaultHeight: 560,
  minWidth: 640,
  minHeight: 420,
  closeOnBlur: false,
  resizable: true,
}

const qrCodePlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Generate QR Code',
        titleI18n: { zh: '生成二维码', en: 'Generate QR Code' },
        icon: 'QrCode',
        aliases: ['qr', 'qrcode', 'qr code', 'generate qr', '二维码', '生成二维码'],
        textMatch: (text) => isHttpUrl(text) && !isImageDataUrl(text),
        component: QrSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: QR_SHELL,
      },
      {
        id: 'scan',
        kind: 'custom-view',
        title: 'Decode QR Code',
        titleI18n: { zh: '识别二维码', en: 'Decode QR Code' },
        icon: 'ScanLine',
        aliases: ['qr decode', 'scan qr', '识别二维码', '扫码'],
        textMatch: isImageDataUrl,
        component: QrSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: QR_SHELL,
      },
    ],
  },
})

export default qrCodePlugin
