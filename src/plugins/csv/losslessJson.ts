import { getPluginHostSdk } from '@hiven/plugin'

/** Lossless JSON helpers come from the host SDK, so int64 and long decimals keep their digits. */
export function parseJsonLossless(text: string): unknown {
  return getPluginHostSdk().kits.textTransforms.parseJsonLossless(text)
}

export function stringifyJsonLossless(value: unknown, indent?: number | string): string {
  return getPluginHostSdk().kits.textTransforms.stringifyJsonLossless(value, indent)
}

const MARKER = '\u0001N'

/** Lossless numbers parse to marker strings; everything else is returned unchanged. */
export function isLosslessMarker(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MARKER)
}

export function markerText(value: string): string {
  return value.slice(MARKER.length)
}
