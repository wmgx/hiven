import { getPluginHostSdk } from '@hiven/plugin'

export const { urlEncode, urlDecode } = getPluginHostSdk().kits.textTransforms

export type EncodeDecodeFormat = 'base64' | 'url' | 'html' | 'slashes' | 'jwt'
export type EncodeDecodeDirection = 'encode' | 'decode'

export function base64Encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

export function base64Decode(text: string): string {
  return decodeURIComponent(escape(atob(text.trim())))
}

export function htmlEncode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function htmlDecode(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

export function escapeSlashes(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export function unescapeSlashes(text: string): string {
  const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t' }
  return text.replace(/\\([nrt"'\\])/g, (_, character: string) => escapes[character] ?? character)
}

export function decodeJwt(text: string): string {
  const parts = text.trim().split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT (expected 3 parts)')
  const decode = (segment: string) => {
    const padded = segment + '='.repeat((4 - segment.length % 4) % 4)
    return JSON.parse(decodeURIComponent(escape(atob(padded.replace(/-/g, '+').replace(/_/g, '/')))))
  }
  return `// Header\n${JSON.stringify(decode(parts[0]), null, 2)}\n\n// Payload\n${JSON.stringify(decode(parts[1]), null, 2)}`
}

export function transformText(format: EncodeDecodeFormat, direction: EncodeDecodeDirection, text: string): string {
  if (format === 'base64') return direction === 'encode' ? base64Encode(text) : base64Decode(text)
  if (format === 'url') return direction === 'encode' ? urlEncode(text) : urlDecode(text)
  if (format === 'html') return direction === 'encode' ? htmlEncode(text) : htmlDecode(text)
  if (format === 'slashes') return direction === 'encode' ? escapeSlashes(text) : unescapeSlashes(text)
  return decodeJwt(text)
}

export function isBase64(text: string): boolean {
  const value = text.trim()
  return value.length >= 4 && /^[A-Za-z0-9+/\n\r]+=*$/.test(value) && value.length % 4 <= 1
}

export function isUrlEncoded(text: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(text)
}

export function hasHtmlEntities(text: string): boolean {
  return /&(?:amp|lt|gt|quot|#39|#\d+|#x[0-9a-f]+);/i.test(text)
}

export function hasEscapeSequences(text: string): boolean {
  return /\\[nrt"'\\]/.test(text)
}

export function isJwt(text: string): boolean {
  const value = text.trim()
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false
  try {
    const headerSegment = value.split('.')[0] ?? ''
    if (headerSegment.length < 4) return false
    const padded = headerSegment + '='.repeat((4 - headerSegment.length % 4) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof Buffer !== 'undefined'
      ? Buffer.from(base64, 'base64').toString('utf8')
      : typeof atob === 'function' ? atob(base64) : ''
    const header = JSON.parse(json) as { alg?: unknown }
    return Boolean(header && typeof header === 'object' && typeof header.alg === 'string' && header.alg)
  } catch {
    return false
  }
}
