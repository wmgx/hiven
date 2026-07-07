import { memo, useEffect, useRef } from 'react'
import { t, type Locale } from '../../i18n'
import { resolveIcon } from '../../utils/resolveIcon'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import type { MatchRange, MatchType } from '../../workspace/searchRanking'

export type LauncherMixedItem =
  | { kind: 'domain'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; shortcut?: string; domainItem: DomainLauncherItem; matchRanges?: MatchRange[]; matchType?: MatchType }

/** Maximum items rendered in the list when no query is active. */
export const MAX_VISIBLE_IDLE = 20

export function LauncherMixedList({
  items,
  selected,
  locale,
  truncate = false,
  onSelect,
  onHoverIndex,
}: {
  items: LauncherMixedItem[]
  selected?: LauncherMixedItem
  locale: Locale
  /** When true, cap visible items and show a "type to refine" hint. */
  truncate?: boolean
  onSelect: (item: LauncherMixedItem) => void
  onHoverIndex?: (index: number) => void
}) {
  if (items.length === 0) return null

  const shouldTruncate = truncate && items.length > MAX_VISIBLE_IDLE
  const visible = shouldTruncate ? items.slice(0, MAX_VISIBLE_IDLE) : items

  return (
    <>
      {visible.map((item, index) => {
        const isSelected = selected?.kind === item.kind && selected.id === item.id
        return (
          <LauncherMixedListItem
            key={`${item.kind}:${item.id}`}
            item={item}
            index={index}
            selected={isSelected}
            locale={locale}
            onSelect={onSelect}
            onMouseEnter={() => onHoverIndex && onHoverIndex(index)}
          />
        )
      })}
      {shouldTruncate && (
        <div className="launcher-more-hint">
          {t(locale, 'palette.moreResultsHint')}
        </div>
      )}
    </>
  )
}

const LauncherMixedListItem = memo(function LauncherMixedListItem({
  item,
  index,
  selected,
  locale,
  onSelect,
  onMouseEnter,
}: {
  item: LauncherMixedItem
  index: number
  selected: boolean
  locale: Locale
  onSelect: (item: LauncherMixedItem) => void
  onMouseEnter?: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const appIcon = isAppIconRef(item.icon)
  const tag = getLauncherItemKindLabel(item, locale)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const staggerDelay = index < 8 ? `${index * 12}ms` : '0ms'

  return (
    <button
      ref={ref}
      className={`l-row cmd-item anim-palette-item w-full border-none text-left ${selected ? 'sel selected' : ''}`}
      style={{ animationDelay: staggerDelay }}
      onClick={() => onSelect(item)}
      onMouseEnter={onMouseEnter}
    >
      <span className={appIcon ? 'r-app' : 'r-ico'}>
        {appIcon ? (
          <span className="app-icon">
            {resolveIcon(item.icon, 16, item.title)}
          </span>
        ) : (
          resolveIcon(item.icon, 16, item.title)
        )}
      </span>

      <div className="r-main">
        <span className="r-title launcher-item-title">
          <HighlightedTitle title={item.title} ranges={item.matchRanges} />
        </span>
        {item.subtitle && (
          <span className="r-desc">{item.subtitle}</span>
        )}
      </div>
      {item.shortcut && (
        <kbd className="r-shortcut-badge">{item.shortcut}</kbd>
      )}
      <span className="r-tag launcher-kind-tag">
        {tag}
        {item.matchType === 'pinyin' && (
          <span className="launcher-pinyin-badge">{t(locale, 'palette.pinyinBadge')}</span>
        )}
      </span>
      {selected && <span className="r-kbd">↵</span>}
    </button>
  )
})

function getLauncherItemKindLabel(item: LauncherMixedItem, locale: Locale) {
  if (item.kind === 'domain' && item.domainItem.display.kindLabel) {
    return item.domainItem.display.kindLabel
  }
  if (isAppIconRef(item.icon)) return t(locale, 'palette.kindApp')
  return t(locale, 'palette.kindCommand')
}

function isAppIconRef(icon?: string): boolean {
  return icon?.startsWith('app-icon:') === true
}

// ─── Highlighted Title Rendering ─────────────────────────────────────────────

function HighlightedTitle({ title, ranges }: { title: string; ranges?: MatchRange[] }) {
  if (!ranges || ranges.length === 0) {
    return <>{title}</>
  }

  const segments: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: title.slice(cursor, range.start), highlight: false })
    }
    segments.push({ text: title.slice(range.start, range.end), highlight: true })
    cursor = range.end
  }

  if (cursor < title.length) {
    segments.push({ text: title.slice(cursor), highlight: false })
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <span key={i} className="launcher-match-highlight">{seg.text}</span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
}
