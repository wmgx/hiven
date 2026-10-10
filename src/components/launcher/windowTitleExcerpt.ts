import type { MatchRange } from '../../workspace/searchRanking'

export type WindowTitleExcerpt = { text: string; ranges: MatchRange[] }
type MeasureTitle = (text: string, ranges: MatchRange[]) => number

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : undefined

/** Visual-only slices. All source/range offsets remain UTF-16 offsets. */
export function windowTitleExcerpt(
  title: string,
  ranges: readonly MatchRange[] | undefined,
  width: number,
  measure: MeasureTitle,
): WindowTitleExcerpt {
  // Older webviews keep the original text and CSS ellipsis. Array.from would
  // split combining marks, flags and ZWJ emoji, so it is not a safe fallback.
  if (!segmenter) return { text: title, ranges: [] }
  const boundaries = [0, ...Array.from(segmenter.segment(title), ({ index, segment }) => index + segment.length)]
  const boundaryAt = (offset: number, roundUp: boolean) => {
    let low = 0
    let high = boundaries.length - 1
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (boundaries[mid] < offset) low = mid + 1
      else high = mid
    }
    return !roundUp && boundaries[low] > offset ? boundaries[low - 1] : boundaries[low]
  }
  const sortedRanges = (ranges ?? []).filter(({ start, end }) =>
    Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= title.length,
  // A query can match just one member of a ZWJ emoji or a combining sequence.
  // Highlight the whole visible grapheme; the model's original ranges stay intact.
  ).map(({ start, end }) => ({ start: boundaryAt(start, false), end: boundaryAt(end, true) }))
    .sort((a, b) => a.start - b.start)
  const validRanges: MatchRange[] = []
  for (const range of sortedRanges) {
    const previous = validRanges.at(-1)
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else validRanges.push({ ...range })
  }
  const full = { text: title, ranges: validRanges }
  if (measure(title, validRanges) <= width) return full
  if (!(width > 0)) return { text: '', ranges: [] }

  const count = boundaries.length - 1
  const compose = (slices: Array<[number, number]>): WindowTitleExcerpt => {
    let text = ''
    const mapped: MatchRange[] = []
    let cursor = 0
    for (const [from, to] of slices) {
      if (from >= to) continue
      const start = boundaries[from]
      const end = boundaries[to]
      if (start > cursor) text += '…'
      const offset = text.length
      text += title.slice(start, end)
      for (const range of validRanges) {
        const overlapStart = Math.max(start, range.start)
        const overlapEnd = Math.min(end, range.end)
        if (overlapStart < overlapEnd) {
          mapped.push({ start: offset + overlapStart - start, end: offset + overlapEnd - start })
        }
      }
      cursor = end
    }
    if (cursor < title.length) text += '…'
    return { text, ranges: mapped }
  }
  const fits = (excerpt: WindowTitleExcerpt, budget = width) => measure(excerpt.text, excerpt.ranges) <= budget
  const ellipsis = { text: '…', ranges: [] }
  if (!fits(ellipsis)) return { text: '', ranges: [] }

  // Binary searches bound font measurement work even for very long titles.
  const lastFit = (low: number, high: number, test: (index: number) => boolean) => {
    if (test(high)) return high // Reaching the edge removes an ellipsis.
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (test(mid)) low = mid
      else high = mid - 1
    }
    return low
  }
  const firstFit = (low: number, high: number, test: (index: number) => boolean) => {
    if (test(low)) return low
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (test(mid)) high = mid
      else low = mid + 1
    }
    return low
  }

  const match = validRanges[0]
  if (match) {
    const start = Math.max(0, boundaries.findIndex((offset) => offset > match.start) - 1)
    const end = boundaries.findIndex((offset) => offset >= match.end)
    const anchor = compose([[start, end]])
    if (!fits(anchor)) {
      // An oversized match still gets the available space, starting at a
      // complete grapheme. Never substitute unrelated head/tail text here.
      const partialEnd = lastFit(start, end, (to) => fits(compose([[start, to]])))
      return partialEnd > start ? compose([[start, partialEnd]]) : ellipsis
    }
    const remaining = width - measure(anchor.text, anchor.ranges)
    let right = lastFit(end, count, (to) => fits(compose([[start, to]]), width - remaining / 3))
    const left = firstFit(0, start, (from) => fits(compose([[from, right]])))
    right = lastFit(right, count, (to) => fits(compose([[left, to]])))
    return compose([[left, right]])
  }

  // App-only/pinyin/no-query matches have no trustworthy title anchor. Keep a
  // short recognisable head and spend most of the pixels on the distinguishing tail.
  const headBudget = (width - measure('…', [])) / 4
  const head = lastFit(0, count - 1, (to) => measure(title.slice(0, boundaries[to]), []) <= headBudget)
  const tail = firstFit(head + 1, count, (from) => fits(compose([[0, head], [from, count]])))
  const excerpt = compose([[0, head], [tail, count]])
  return fits(excerpt) ? excerpt : ellipsis
}
