import { memo, useEffect, useRef, type MouseEvent } from 'react'
import { Pin } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import { resolveIcon } from '../../utils/resolveIcon'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherItem } from '../../workspace/launcher/types'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsParamCustomization } from '../../components/launcher/launcherParamShortcuts'

export function LauncherList({
  items,
  selectedIndex,
  selectItem,
  onPinItem,
  setSelectedIndex,
  isKeyboardNavigation,
  onMouseNavigation,
  locale,
}: {
  items: LauncherItem[]
  selectedIndex: number
  selectItem: (item: LauncherItem, customizeParams?: boolean) => void
  onPinItem?: (item: LauncherItem) => void
  setSelectedIndex: (index: number) => void
  isKeyboardNavigation: () => boolean
  onMouseNavigation: () => void
  locale: Locale
}) {
  return (
    <div className="command-palette-results global-launcher-body l-list" onMouseMove={onMouseNavigation}>
      {items.map((item, index) => (
        <LauncherActionItem
          key={item.systemKey}
          item={item}
          selected={selectedIndex === index}
          onClick={(event) => selectItem(item, shouldCustomizeParams(event.metaKey, event.ctrlKey))}
          onPin={onPinItem ? () => onPinItem(item) : undefined}
          onMouseEnter={() => {
            if (!isKeyboardNavigation()) setSelectedIndex(index)
          }}
          locale={locale}
        />
      ))}
      {items.length === 0 && (
        <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {t(locale, 'palette.noResults')}
        </div>
      )}
    </div>
  )
}

const LauncherActionItem = memo(function LauncherActionItem({
  item,
  selected,
  onClick,
  onPin,
  onMouseEnter,
  locale,
}: {
  item: LauncherItem
  selected: boolean
  onClick: (event: MouseEvent<HTMLDivElement>) => void
  onPin?: () => void
  onMouseEnter: () => void
  locale: Locale
}) {
  const ref = useRef<HTMLDivElement>(null)
  const title = resolveDisplayTitle(item.display, locale)
  const subtitle = resolveDisplaySubtitle(item.display, locale)
  const canPin = Boolean(onPin) && item.pinnable !== false
  const shortcutMeta = getPlatformShortcutMeta()
  const showParamShortcut = supportsParamCustomization(item)
  const tag = item.display.icon?.startsWith('app-icon:')
    ? t(locale, 'palette.kindApp')
    : t(locale, 'palette.kindCommand')

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      className={`l-row command-launcher-row ${selected ? 'sel selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className={item.display.icon?.startsWith('app-icon:') ? 'r-app' : 'r-ico'}>
        {resolveIcon(item.display.icon, 16, item.systemKey)}
      </span>
      <div className="r-main">
        <div className="flex items-center gap-1.5 min-w-0">
          {item.source === 'dev' && (
            <span className="text-[9px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: 'var(--color-accent)', color: '#fff' }}>DEV</span>
          )}
          <div className="r-title launcher-item-title">
            {title}
          </div>
        </div>
        {subtitle && (
          <div className="r-desc">
            {subtitle}
          </div>
        )}
      </div>
      {item.behavior.type === 'collect-input' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}>
          {t(locale, 'palette.hasInput')}
        </span>
      )}
      {showParamShortcut && (
        <span className="customize-shortcut-chip text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}>
          {shortcutMeta.label}↵ {t(locale, 'palette.customizeParamsLabel')}
        </span>
      )}
      <span className="r-tag launcher-kind-tag">
        {tag}
      </span>
      {canPin && (
        <button
          data-testid="launcher-item-pin-action"
          className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0"
          title={t(locale, 'palette.pinAction')}
          style={{ color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onPin()
          }}
        >
          <Pin size={13} />
        </button>
      )}
      {selected && (
        <span className="r-kbd">↵</span>
      )}
    </div>
  )
})
