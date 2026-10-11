export type JsonCursorPath = { jsonPath: string; pointer: string }
export type JsonCursorPathResult = { ok: true; value: JsonCursorPath } | { ok: false; reason: 'invalid' | 'duplicate' | 'position' | 'limit' }
type Segment = string | number
type Span = { start: number; end: number; path: Segment[] }
const MAX_TEXT = 1000000
const MAX_DEPTH = 128

export function formatJsonCursorPath(path: Segment[]): JsonCursorPath {
  return {
    jsonPath: '$' + path.map((part) => typeof part === 'number' ? `[${part}]` : `[${JSON.stringify(part)}]`).join(''),
    pointer: path.map((part) => '/' + String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join(''),
  }
}

/** Token locations only: punctuation and whitespace do not guess a nearby field.
 * Reject duplicate decoded keys in any object, including escaped-equivalent keys. */
export function jsonCursorPath(text: string, offset: number): JsonCursorPathResult {
  if (text.length > MAX_TEXT) return { ok: false, reason: 'limit' }
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) return { ok: false, reason: 'position' }
  try { JSON.parse(text) } catch { return { ok: false, reason: 'invalid' } }
  let at = 0, duplicate = false
  const spans: Span[] = []
  const skip = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++ }
  const string = (path: Segment[]) => {
    const start = at++
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue }
      if (text[at++] === '"') break
    }
    spans.push({ start, end: at, path })
    return JSON.parse(text.slice(start, at)) as string
  }
  const value = (path: Segment[], depth: number) => {
    if (depth > MAX_DEPTH) throw new RangeError('depth')
    skip()
    if (text[at] === '"') { string(path); return }
    if (text[at] === '{' || text[at] === '[') {
      const object = text[at] === '{', close = object ? '}' : ']'
      // A container's own braces/brackets identify the container value.
      spans.push({ start: at, end: ++at, path })
      skip()
      let index = 0
      const keys = new Set<string>()
      while (text[at] !== close) {
        let child: Segment[]
        if (object) {
          const keyStart = spans.length
          const key = string(path)
          if (keys.has(key)) duplicate = true
          keys.add(key)
          child = [...path, key]
          spans[keyStart].path = child
          skip(); at++ // colon; JSON.parse already validated the grammar.
        } else child = [...path, index++]
        value(child, depth + 1)
        skip()
        if (text[at] === close) break
        at++; skip() // comma
      }
      spans.push({ start: at, end: ++at, path })
      return
    }
    const start = at
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++
    spans.push({ start, end: at, path })
  }
  try { value([], 0) } catch { return { ok: false, reason: 'limit' } }
  if (duplicate) return { ok: false, reason: 'duplicate' }
  const span = spans.find((item) => offset >= item.start && offset < item.end)
  return span ? { ok: true, value: formatJsonCursorPath(span.path) } : { ok: false, reason: 'position' }
}
