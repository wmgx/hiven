import { memo, useEffect, useRef } from 'react'
import { Pin } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import { resolveIcon } from '../../utils/resolveIcon'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'

export type LauncherMixedItem =
  | { kind: 'domain'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; domainItem: DomainLauncherItem }
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; actionId: string }

export function LauncherMixedList({
  items,
  selected,
  locale,
  onSelect,
  onHoverIndex,
}: {
  items: LauncherMixedItem[]
  selected?: LauncherMixedItem
  locale: Locale
  onSelect: (item: LauncherMixedItem) => void
  onHoverIndex?: (index: number) => void
}) {
  if (items.length === 0) return null
  return (
    <>
      {items.map((item, index) => {
        const isSelected = selected?.kind === item.kind && selected.id === item.id
        return (
          <LauncherMixedListItem
            key={`${item.kind}:${item.id}`}
            item={item}
            selected={isSelected}
            locale={locale}
            onSelect={onSelect}
            onMouseEnter={() => onHoverIndex && onHoverIndex(index)}
          />
        )
      })}
    </>
  )
}

const LauncherMixedListItem = memo(function LauncherMixedListItem({
  item,
  selected,
  locale,
  onSelect,
  onMouseEnter,
}: {
  item: LauncherMixedItem
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

  return (
    <button
      ref={ref}
      className={`l-row cmd-item w-full border-none text-left ${selected ? 'sel selected' : ''}`}
      onClick={() => onSelect(item)}
      onMouseEnter={onMouseEnter}
    >
      <span className={appIcon ? 'r-app' : 'r-ico'}>
        {appIcon ? (
          <span className="app-icon">
            {item.kind === 'domain'
              ? resolveIcon(item.icon, 16, item.title)
              : (resolveIcon(item.icon, 16, item.title) || <Pin size={16} />)}
          </span>
        ) : (
          item.kind === 'domain'
            ? resolveIcon(item.icon, 16, item.title)
            : (resolveIcon(item.icon, 16, item.title) || <Pin size={16} />)
        )}
      </span>

      <div className="r-main">
        <span className="r-title launcher-item-title">
          {item.title}
        </span>
        {item.subtitle && (
          <span className="r-desc">{item.subtitle}</span>
        )}
      </div>
      <span className="r-tag launcher-kind-tag">
        {tag}
      </span>
      {selected && <span className="r-kbd">↵</span>}
    </button>
  )
})

function getLauncherItemKindLabel(item: LauncherMixedItem, locale: Locale) {
  if (item.kind === 'domain' && item.domainItem.display.kindLabel) {
    return item.domainItem.display.kindLabel
  }
  if (item.kind === 'pinned') return t(locale, 'palette.kindPinned')
  if (isAppIconRef(item.icon)) return t(locale, 'palette.kindApp')
  return t(locale, 'palette.kindCommand')
}

function isAppIconRef(icon?: string): boolean {
  return icon?.startsWith('app-icon:') === true
}
