import { memo, useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { t, type Locale } from '../../i18n'
import { resolveIcon } from '../../utils/resolveIcon'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import type { MatchRange, MatchType } from '../../workspace/searchRanking'
import { getPlatformShortcutMeta, isMacPlatform } from './launcherParamShortcuts'

/** Rows 1–8 are quick-run via ⌘N / Ctrl+N (see GlobalLauncherKeyboard). */
export const QUICK_SELECT_MAX = 8

function quickSelectBadge(index: number): string | null {
  if (index < 0 || index >= QUICK_SELECT_MAX) return null
  // Compact glyph on both platforms so the trailing column stays narrow.
  const mod = isMacPlatform() ? getPlatformShortcutMeta().label : '⌃'
  return `${mod}${index + 1}`
}

export type LauncherMixedItem =
  | { kind: 'domain'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; shortcut?: string; domainItem: DomainLauncherItem; matchRanges?: MatchRange[]; matchType?: MatchType }

/** Maximum items rendered in the list when no query is active (scannable empty-open). */
export const MAX_VISIBLE_IDLE = 12

export function LauncherMixedList({
  items,
  selected,
  locale,
  truncate = false,
  onSelect,
  onHoverIndex,
  isKeyboardNavRef,
}: {
  items: LauncherMixedItem[]
  selected?: LauncherMixedItem
  locale: Locale
  /** When true, cap visible items and show a "type to refine" hint. */
  truncate?: boolean
  onSelect: (item: LauncherMixedItem) => void
  onHoverIndex?: (index: number) => void
  /**
   * When true, selected row scrolls into view. Hover must leave this false so
   * mouse move does not force reflow via scrollIntoView on every row.
   */
  isKeyboardNavRef?: MutableRefObject<boolean>
}) {
  if (items.length === 0) return null

  const shouldTruncate = truncate && items.length > MAX_VISIBLE_IDLE
  const visible = shouldTruncate ? items.slice(0, MAX_VISIBLE_IDLE) : items

  // Stable identity for memo children — do not allocate per-row lambdas in map.
  const handleHover = useCallback((index: number) => {
    onHoverIndex?.(index)
  }, [onHoverIndex])

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
            onHoverIndex={onHoverIndex ? handleHover : undefined}
            isKeyboardNavRef={isKeyboardNavRef}
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
  onHoverIndex,
  isKeyboardNavRef,
}: {
  item: LauncherMixedItem
  index: number
  selected: boolean
  locale: Locale
  onSelect: (item: LauncherMixedItem) => void
  onHoverIndex?: (index: number) => void
  isKeyboardNavRef?: MutableRefObject<boolean>
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const appIcon = isAppIconRef(item.icon)
  const avatarIcon = isRemoteAvatarIcon(item.icon)
  const tag = getLauncherItemKindLabel(item, locale)
  // SuperCmd-style: show ⌘1…⌘8 on the first eight rows so quick-run is discoverable.
  const quickSelectLabel = quickSelectBadge(index)
  const iconSlotClass = appIcon ? 'r-app' : avatarIcon ? 'r-ico r-avatar' : 'r-ico'

  useEffect(() => {
    // Keyboard nav only — hover selection already keeps the row under the cursor.
    if (selected && isKeyboardNavRef?.current) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected, isKeyboardNavRef])

  const handleMouseEnter = useCallback(() => {
    onHoverIndex?.(index)
  }, [index, onHoverIndex])

  const handleClick = useCallback(() => {
    onSelect(item)
  }, [item, onSelect])

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      data-launcher-row-index={index}
      data-quick-select={quickSelectLabel ?? undefined}
      className={`l-row cmd-item w-full border-none text-left ${selected ? 'sel selected' : ''}`}
      onClick={handleClick}
      // Hover select is gated by parent (must move pointer first); enter alone is not enough.
      onMouseEnter={onHoverIndex ? handleMouseEnter : undefined}
      // Keep the search caret — do not let list rows take focus on mousedown.
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className={iconSlotClass}>
        {appIcon ? (
          <span className="app-icon">
            {resolveIcon(item.icon, 20, item.title)}
          </span>
        ) : (
          resolveIcon(item.icon, 18, item.title)
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
      {item.shortcut && !quickSelectLabel && (
        <kbd className="r-shortcut-badge">{item.shortcut}</kbd>
      )}
      {/* Prefer ⌘N over noisy kind pills; keep kind only when no quick-select. */}
      {!quickSelectLabel && (
        <span className="r-tag launcher-kind-tag">
          {tag}
          {item.matchType === 'pinyin' && (
            <span className="launcher-pinyin-badge">{t(locale, 'palette.pinyinBadge')}</span>
          )}
        </span>
      )}
      {quickSelectLabel && (
        <kbd className={`r-shortcut-badge r-quick-select${selected ? ' is-selected' : ''}`}>
          {quickSelectLabel}
        </kbd>
      )}
    </button>
  )
})

function getLauncherItemKindLabel(item: LauncherMixedItem, locale: Locale) {
  if (item.kind === 'domain' && item.domainItem.display) {
    const display = item.domainItem.display
    const i18n = display.kindLabelI18n
    if (i18n) {
      const localized = i18n[locale] ?? i18n.en ?? i18n.zh
      if (localized) return localized
    }
    if (display.kindLabel) return display.kindLabel
  }
  if (isAppIconRef(item.icon)) return t(locale, 'palette.kindApp')
  return t(locale, 'palette.kindCommand')
}

function isAppIconRef(icon?: string): boolean {
  return icon?.startsWith('app-icon:') === true
}

/** Feishu person/group avatars (https / data-URL) need the avatar plate, not lucide color. */
function isRemoteAvatarIcon(icon?: string): boolean {
  if (!icon) return false
  return (
    icon.startsWith('https://') ||
    icon.startsWith('http://') ||
    icon.startsWith('data:image/')
  )
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
