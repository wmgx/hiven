import { useEffect, useRef, type MouseEvent, type MutableRefObject, type RefObject } from 'react'
import { Pin, Search } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import { resolveIcon } from '../../utils/resolveIcon'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherItem } from '../../workspace/launcher/types'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsParamCustomization } from './launcherParamShortcuts'
import { LauncherHintKey } from './LauncherFooterHints'

export function LauncherDomainSearchStep({
  inputRef,
  query,
  setQuery,
  items,
  selectedIndex,
  selectItem,
  onPinItem,
  setSelectedIndex,
  isKeyboardNavRef,
  locale,
  error,
  busy,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  setQuery: (value: string) => void
  items: LauncherItem[]
  selectedIndex: number
  selectItem: (item: LauncherItem, customizeParams?: boolean) => void
  onPinItem: (item: LauncherItem) => void
  setSelectedIndex: (index: number) => void
  isKeyboardNavRef: MutableRefObject<boolean>
  locale: Locale
  error: string | null
  busy: boolean
}) {
  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <Search className="ico" />
        <input
          ref={inputRef}
          placeholder={t(locale, 'palette.globalPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {busy && (
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>...</span>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[11px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <div className="command-palette-results global-launcher-body l-list" onMouseMove={() => { isKeyboardNavRef.current = false }}>
        {items.map((item, index) => (
          <LauncherDomainListItem
            key={item.systemKey}
            item={item}
            selected={selectedIndex === index}
            onClick={(event) => selectItem(item, shouldCustomizeParams(event.metaKey, event.ctrlKey))}
            onPin={() => onPinItem(item)}
            onMouseEnter={() => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
            locale={locale}
          />
        ))}
        {items.length === 0 && (
          <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {t(locale, 'palette.noResults')}
          </div>
        )}
      </div>
      <div className="global-launcher-footer l-foot">
        <LauncherHintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        <LauncherHintKey keys="↵" label={t(locale, 'palette.select')} />
        {supportsParamCustomization(items[selectedIndex]) && (
          <LauncherHintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
        )}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.close')} />
      </div>
    </>
  )
}

function LauncherDomainListItem({
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
  onPin: () => void
  onMouseEnter: () => void
  locale: Locale
}) {
  const ref = useRef<HTMLDivElement>(null)
  const title = resolveDisplayTitle(item.display, locale)
  const subtitle = resolveDisplaySubtitle(item.display, locale)
  const canPin = item.pinnable !== false
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
      className={`l-row command-launcher-row cmd-item ${selected ? 'sel selected' : ''}`}
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
          <div className="r-title launcher-item-title">{title}</div>
        </div>
        {subtitle && <div className="r-desc">{subtitle}</div>}
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
      <span className="r-tag launcher-kind-tag">{tag}</span>
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
      {selected && <span className="r-kbd">↵</span>}
    </div>
  )
}
