import type { PluginImageAnalysisApi, PluginImageAnalysisResult } from './pluginTypes'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function isMacDesktop(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
    && /Mac/i.test(navigator.platform)
}

export function createPluginImageAnalysis(): PluginImageAnalysisApi | undefined {
  if (!isMacDesktop()) return undefined
  return {
    async recognizeText(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new TypeError('Image bytes must be between 1 byte and 10 MiB')
      }
      const { invoke } = await import('@tauri-apps/api/core')
      return invoke<PluginImageAnalysisResult>('recognize_image_text', bytes)
    },
  }
}
