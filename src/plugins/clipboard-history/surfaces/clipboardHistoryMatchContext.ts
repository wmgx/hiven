/** Display-only search context. Never use these slices as clipboard payloads. */
import {
  getClipboardHistorySearchNeedles,
  type ClipboardHistorySearchMatchMode,
} from '../storage/clipboardHistorySearch.ts'

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

function findDisplayMatches(
  text: string,
  query: string,
  matchMode: ClipboardHistorySearchMatchMode,
  maxMatches: number,
  allTermsAlreadyValidated = false,
): {
  ranges: MatchRange[]
  graphemes: Intl.Segments
} | null {
  // Bounds apply only to extra search/decoration work. Keep the original body
  // untouched when a value is too large, or the webview lacks safe segmentation.
  // Do not lower-case a prefix: that changes contextual casing such as final Σ.
  if (!segmenter || !text || text.length > CLIPBOARD_HISTORY_MATCH_LIMITS.maxTextLength
    || query.length > CLIPBOARD_HISTORY_MATCH_LIMITS.maxQueryLength) return null
  // Match the storage search contract: trimmed, case-insensitive literal text
  // or, when explicitly selected, every deduplicated Unicode-whitespace term
  // in this same display field. No normalization, regex or HTML parsing.
  const needles = getClipboardHistorySearchNeedles(query, matchMode)
  if (!needles.length) return null
  const lowerText = text.toLowerCase()
  const firstOffsets = needles.map((needle) => lowerText.indexOf(needle))
  if (firstOffsets.some((offset) => offset < 0) && !(matchMode === 'all-terms' && allTermsAlreadyValidated)) return null
  const lowerRanges = firstOffsets
    .map((start, index) => ({ start, end: start + needles[index].length, needleIndex: index }))
    .filter(({ start }) => start >= 0)
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .slice(0, maxMatches)
  if (!lowerRanges.length) return null
  const nextOffsets = firstOffsets.map((offset, index) => lowerText.indexOf(needles[index], offset + needles[index].length))
  while (lowerRanges.length < maxMatches) {
    let needleIndex = -1
    for (let index = 0; index < nextOffsets.length; index += 1) {
      if (nextOffsets[index] >= 0 && (needleIndex < 0 || nextOffsets[index] < nextOffsets[needleIndex])) needleIndex = index
    }
    if (needleIndex < 0) break
    const start = nextOffsets[needleIndex]
    lowerRanges.push({ start, end: start + needles[needleIndex].length, needleIndex })
    nextOffsets[needleIndex] = lowerText.indexOf(needles[needleIndex], start + needles[needleIndex].length)
  }
  lowerRanges.sort((left, right) => left.start - right.start || right.end - left.end)
  const mapOffset = sourceOffsetMapper(text, lowerText)
  const graphemes = segmenter.segment(text)
  const ranges: MatchRange[] = []
  for (const lowerRange of lowerRanges) {
    const sourceStart = mapOffset(lowerRange.start, false)
    const sourceEnd = mapOffset(lowerRange.end, true)
    const previous = ranges.at(-1)
    // Repeated hits inside one huge combining sequence must not ask ICU to
    // walk that entire grapheme for every hit.
    if (!previous || sourceStart >= previous.end || sourceEnd > previous.end) {
      const start = graphemeBoundary(graphemes, sourceStart, false)
      const end = graphemeBoundary(graphemes, sourceEnd, true)
      if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
      else ranges.push({ start, end })
    }
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
  matchMode: ClipboardHistorySearchMatchMode = 'literal',
  allTermsAlreadyValidated = false,
): ClipboardHistoryMatchContext {
  const text = displayText ?? ''
  const found = findDisplayMatches(text, query, matchMode, CLIPBOARD_HISTORY_MATCH_LIMITS.maxMatches, allTermsAlreadyValidated)
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
  matchMode: ClipboardHistorySearchMatchMode = 'literal',
): string | null {
  const text = displayText ?? ''
  const found = findDisplayMatches(text, query, matchMode, 1)
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
