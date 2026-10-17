import type { PluginTextResultHudHost, PluginTextResultHudRunner } from '@hiven/plugin'
import { decodeQrFromBlob } from './qrCore'
import { QrHudSession } from './qrHudSession'

/** Shortcut -> decode a QR code from the clipboard image -> native HUD. */
export function createQrHud(host: PluginTextResultHudHost): PluginTextResultHudRunner {
  return new QrHudSession({
    async read(signal, isCurrent) {
      const image = await host.readClipboardImage({ signal, isCurrent })
      return new Blob([image.bytes as BlobPart], { type: image.contentType })
    },
    decode: decodeQrFromBlob,
    write: (text, signal) => host.writeClipboardText(text, signal),
    present: (view, fullText) => host.present(view, fullText),
    activate: (view) => host.activate(view),
    dismiss: (sessionId, revision) => host.dismiss(sessionId, revision),
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clearSchedule: (timer) => clearTimeout(timer),
    randomId: () => crypto.randomUUID(),
  })
}
