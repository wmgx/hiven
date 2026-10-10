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
  const value = JSON.parse(text)
  return JSON.stringify(shouldSort ? sortKeys(value) : value, null, indent)
}

export function compactJson(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

export function urlEncode(text: string): string {
  return encodeURIComponent(text)
}

export function urlDecode(text: string): string {
  return decodeURIComponent(text.trim())
}
