import { useLayoutEffect, useRef, useState } from 'react'
import type { MatchRange } from '../../workspace/searchRanking'
import { windowTitleExcerpt, type WindowTitleExcerpt } from './windowTitleExcerpt'

/** X11 titles keep their raw model value; this component only changes pixels. */
export function WindowTitle({ title, ranges }: { title: string; ranges?: MatchRange[] }) {
  const ref = useRef<HTMLSpanElement>(null)
  const highlightRef = useRef<HTMLSpanElement>(null)
  const [measured, setMeasured] = useState<{
    sourceTitle: string; sourceRanges?: MatchRange[]; excerpt: WindowTitleExcerpt
  }>()
  // A changed query/title must never reuse an old excerpt while measurements
  // are unavailable (for example, a webview without a canvas context).
  const excerpt = measured?.sourceTitle === title && measured.sourceRanges === ranges
    ? measured.excerpt
    : { text: title, ranges: [] }

  useLayoutEffect(() => {
    const element = ref.current
    const highlight = highlightRef.current
    const parent = element?.parentElement
    const context = document.createElement('canvas').getContext('2d')
    if (!element || !highlight || !parent || !context) return
    let disposed = false
    const update = () => {
      if (disposed) return
      const style = getComputedStyle(element)
      const highlightStyle = getComputedStyle(highlight)
      const parentStyle = getComputedStyle(parent)
      const parentWidth = parent.clientWidth - (parseFloat(parentStyle.paddingLeft) || 0) - (parseFloat(parentStyle.paddingRight) || 0)
      // Measure the stable flex parent's allotted budget, never this span's
      // shrinking text width. The existing CSS max-width remains authoritative.
      const maxWidth = parseFloat(style.maxWidth)
      const titleBudget = !Number.isFinite(maxWidth) ? parentWidth
        : style.maxWidth.endsWith('%') ? parentWidth * maxWidth / 100 : maxWidth
      const width = Math.max(0, Math.min(parentWidth, titleBudget))
      const measureRun = (text: string, fontStyle: CSSStyleDeclaration) => {
        context.font = `${fontStyle.fontStyle} ${fontStyle.fontWeight} ${fontStyle.fontSize} ${fontStyle.fontFamily}`
        const letterSpacing = parseFloat(fontStyle.letterSpacing) || 0
        if ('letterSpacing' in context) context.letterSpacing = `${letterSpacing}px`
        // Older canvas APIs cannot model spacing. Positive spacing is counted
        // conservatively; ignoring negative spacing also avoids overfilling.
        const extra = 'letterSpacing' in context ? 0 : Math.max(0, letterSpacing) * Array.from(text).length
        return context.measureText(text).width + extra
      }
      const measure = (text: string, highlights: MatchRange[]) => {
        let cursor = 0
        let measured = 0
        for (const range of highlights) {
          measured += measureRun(text.slice(cursor, range.start), style)
          measured += measureRun(text.slice(range.start, range.end), highlightStyle)
          cursor = range.end
        }
        return measured + measureRun(text.slice(cursor), style)
      }
      const next = windowTitleExcerpt(title, ranges, width, measure)
      setMeasured((previous) => previous?.sourceTitle === title && previous.sourceRanges === ranges
        && previous.excerpt.text === next.text && JSON.stringify(previous.excerpt.ranges) === JSON.stringify(next.ranges)
        ? previous : { sourceTitle: title, sourceRanges: ranges, excerpt: next })
    }
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined
    observer?.observe(parent)
    if (!observer) window.addEventListener('resize', update)
    void document.fonts?.ready.then(update)
    document.fonts?.addEventListener('loadingdone', update)
    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', update)
      document.fonts?.removeEventListener('loadingdone', update)
    }
  }, [title, ranges])

  return (
    <span ref={ref} className="r-title launcher-item-title" title={title} aria-hidden="true">
      <HighlightedTitle title={excerpt.text} ranges={excerpt.ranges} />
      <span ref={highlightRef} className="launcher-match-highlight" />
    </span>
  )
}

export function HighlightedTitle({ title, ranges }: { title: string; ranges?: MatchRange[] }) {
  if (!ranges || ranges.length === 0) return <>{title}</>

  const segments: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: title.slice(cursor, range.start), highlight: false })
    segments.push({ text: title.slice(range.start, range.end), highlight: true })
    cursor = range.end
  }
  if (cursor < title.length) segments.push({ text: title.slice(cursor), highlight: false })
  return <>{segments.map((segment, index) => (
    <span key={index} className={segment.highlight ? 'launcher-match-highlight' : undefined}>{segment.text}</span>
  ))}</>
}
