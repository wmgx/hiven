import { getPluginHostSdk } from '@hiven/plugin'

export const { urlEncode } = getPluginHostSdk().kits.textTransforms

/** Form-style decoding: `+` is a space; a literal plus travels as %2B. */
export function urlDecode(text: string): string {
  return decodeURIComponent(text.trim().replace(/\+/g, ' '))
}

/** Coded failures so surfaces can show localized text instead of engine messages. */
export class EncodeDecodeError extends Error {
  readonly code: 'jwt' | 'base64' | 'url'
  constructor(code: 'jwt' | 'base64' | 'url') { super(code); this.code = code }
}

/** Maps any conversion failure onto an i18n key (`error.<code>`), falling back to the generic one. */
export function conversionErrorKey(error: unknown): string {
  if (error instanceof EncodeDecodeError) return `error.${error.code}`
  if (error instanceof URIError) return 'error.url'
  return 'error.invalid'
}

export type EncodeDecodeFormat = 'base64' | 'url' | 'html' | 'slashes' | 'jwt'
export type EncodeDecodeDirection = 'encode' | 'decode'

export function base64Encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

/** Accepts standard and URL-safe alphabets, with or without padding and line breaks. */
export function base64Decode(text: string): string {
  const compact = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]+$/.test(compact)) throw new EncodeDecodeError('base64')
  try {
    return decodeURIComponent(escape(atob(compact + '='.repeat((4 - compact.length % 4) % 4))))
  } catch {
    throw new EncodeDecodeError('base64')
  }
}

export function htmlEncode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** One pass, so `&amp;lt;` becomes `&lt;` and is never decoded twice. */
export function htmlDecode(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/g, (entity, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name]
    const code = dec !== undefined ? Number(dec) : parseInt(hex!, 16)
    const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : entity
  })
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
  return text.replace(/\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|([nrt"'\\]))/g, (match, braced?: string, fixed?: string, character?: string) => {
    if (character) return escapes[character] ?? character
    const code = parseInt((braced ?? fixed)!, 16)
    return code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

export function decodeJwt(text: string): string {
  const parts = text.trim().split('.')
  if (parts.length !== 3) throw new EncodeDecodeError('jwt')
  const decode = (segment: string) => {
    const padded = segment + '='.repeat((4 - segment.length % 4) % 4)
    try {
      return JSON.parse(decodeURIComponent(escape(atob(padded.replace(/-/g, '+').replace(/_/g, '/')))))
    } catch {
      throw new EncodeDecodeError('jwt')
    }
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
  const value = text.replace(/\s+/g, '')
  if (value.length < 4 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return false
  if (value.replace(/=+$/, '').length % 4 === 1) return false
  try {
    // Plain words such as `password` have a valid length but are not UTF-8 text once decoded.
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(base64Decode(value))
  } catch {
    return false
  }
}

export function isUrlEncoded(text: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(text)
}

export function hasHtmlEntities(text: string): boolean {
  return /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/i.test(text)
}

export function hasEscapeSequences(text: string): boolean {
  return /\\(?:[nrt"'\\]|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]{1,6}\})/.test(text)
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
