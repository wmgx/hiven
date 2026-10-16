import { parseJsonLossless, stringifyJsonLossless } from '../jsonLossless.ts'

export { parseJsonLossless, stringifyJsonLossless }

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      sortKeys((value as Record<string, unknown>)[key]),
    ]))
  }
  return value
}

export function formatJson(text: string, indent = 2, shouldSort = false): string {
  const value = parseJsonLossless(text)
  return stringifyJsonLossless(shouldSort ? sortKeys(value) : value, indent)
}

export function compactJson(text: string): string {
  return stringifyJsonLossless(parseJsonLossless(text))
}

export function urlEncode(text: string): string {
  return encodeURIComponent(text)
}

export function urlDecode(text: string): string {
  return decodeURIComponent(text.trim())
}
