/** Display-only search context. Never use these slices as clipboard payloads. */
export const CLIPBOARD_HISTORY_MATCH_LIMITS = {
  maxTextLength: 1024 * 1024,
  maxQueryLength: 4096,
  maxMatches: 64,
  snippetLength: 192,
  snippetLeadingContext: 6,
} as const

export type ClipboardHistoryMatchSegment = {
  text: string
  /** UTF-16 offsets in the original display text, including whole graphemes. */
  start: number
  end: number
  match: boolean
}

export type ClipboardHistoryMatchContext = {
  segments: ClipboardHistoryMatchSegment[]
  firstMatchOffset: number | null
}

type MatchRange = { start: number; end: number }

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

function graphemeBoundary(segments: Intl.Segments, offset: number, roundUp: boolean): number {
  const containing = segments.containing(offset)
  if (!containing || containing.index === offset) return offset
  return roundUp ? containing.index + containing.segment.length : containing.index
}

/** Map lower-case expansion offsets (e.g. İ → i + combining dot) back once. */
function sourceOffsetMapper(text: string, lowerText: string) {
  let sourceOffset = 0
  let lowerOffset = 0
  return (offset: number, roundUp: boolean): number => {
    if (text.length === lowerText.length) return offset
    while (sourceOffset < text.length && lowerOffset < offset) {
      const character = String.fromCodePoint(text.codePointAt(sourceOffset)!)
      const nextLowerOffset = lowerOffset + character.toLowerCase().length
      if (offset < nextLowerOffset) return roundUp ? sourceOffset + character.length : sourceOffset
      sourceOffset += character.length
      lowerOffset = nextLowerOffset
    }
    return sourceOffset
  }
}

function findDisplayMatches(text: string, query: string, maxMatches: number): {
  ranges: MatchRange[]
  graphemes: Intl.Segments
} | null {
  // Bounds apply only to extra search/decoration work. Keep the original body
  // untouched when a value is too large, or the webview lacks safe segmentation.
  // Do not lower-case a prefix: that changes contextual casing such as final Σ.
  if (!segmenter || !text || text.length > CLIPBOARD_HISTORY_MATCH_LIMITS.maxTextLength
    || query.length > CLIPBOARD_HISTORY_MATCH_LIMITS.maxQueryLength) return null
  // Match the storage search contract: trimmed, case-insensitive literal text.
  // No normalization, regular expression, HTML parsing or privacy detection.
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  const lowerText = text.toLowerCase()
  let offset = lowerText.indexOf(needle)
  if (offset < 0) return null
  const mapOffset = sourceOffsetMapper(text, lowerText)
  const graphemes = segmenter.segment(text)
  const ranges: MatchRange[] = []
  for (let count = 0; offset >= 0 && count < maxMatches; count++) {
    const endOffset = offset + needle.length
    const sourceStart = mapOffset(offset, false)
    const sourceEnd = mapOffset(endOffset, true)
    const previous = ranges.at(-1)
    // Repeated hits inside one huge combining sequence must not ask ICU to
    // walk that entire grapheme for every hit.
    if (!previous || sourceStart >= previous.end || sourceEnd > previous.end) {
      const start = graphemeBoundary(graphemes, sourceStart, false)
      const end = graphemeBoundary(graphemes, sourceEnd, true)
      if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
      else ranges.push({ start, end })
    }
    if (count + 1 < maxMatches) offset = lowerText.indexOf(needle, endOffset)
  }
  return { ranges, graphemes }
}

/**
 * Accept only text already allowed on this surface. Pass null/undefined for
 * masked or unavailable content; do not substitute its underlying raw payload.
 * Segments are ordinary React text children, never HTML. Their concatenation is
 * exactly displayText, including the undecorated tail beyond the match budget.
 */
export function getClipboardHistoryMatchContext(
  displayText: string | null | undefined,
  query: string,
): ClipboardHistoryMatchContext {
  const text = displayText ?? ''
  const found = findDisplayMatches(text, query, CLIPBOARD_HISTORY_MATCH_LIMITS.maxMatches)
  const segments: ClipboardHistoryMatchSegment[] = []
  let offset = 0
  for (const range of found?.ranges ?? []) {
    if (range.start > offset) {
      segments.push({ text: text.slice(offset, range.start), start: offset, end: range.start, match: false })
    }
    segments.push({ text: text.slice(range.start, range.end), ...range, match: true })
    offset = range.end
  }
  if (offset < text.length) {
    segments.push({ text: text.slice(offset), start: offset, end: text.length, match: false })
  }
  return { segments, firstMatchOffset: found?.ranges[0]?.start ?? null }
}

/** One bounded, whole-grapheme context slice; null preserves the default title. */
export function getClipboardHistoryMatchSnippet(
  displayText: string | null | undefined,
  query: string,
): string | null {
  const text = displayText ?? ''
  const found = findDisplayMatches(text, query, 1)
  const first = found?.ranges[0]
  if (!found || !first) return null
  const budget = CLIPBOARD_HISTORY_MATCH_LIMITS.snippetLength
  // A single oversized match/grapheme cannot fit without splitting or hiding
  // the hit. Fall back to the existing title instead of implying a false hit.
  if (first.end - first.start > budget) return null
  const leading = Math.min(CLIPBOARD_HISTORY_MATCH_LIMITS.snippetLeadingContext, budget - (first.end - first.start))
  const lineStart = first.start > 0
    ? Math.max(text.lastIndexOf('\n', first.start - 1), text.lastIndexOf('\r', first.start - 1)) + 1
    : 0
  const desiredStart = Math.max(lineStart, first.start - leading)
  const desiredEnd = Math.min(text.length, desiredStart + budget)
  const start = graphemeBoundary(found.graphemes, desiredStart, true)
  const end = graphemeBoundary(found.graphemes, desiredEnd, false)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
