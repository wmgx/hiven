import { Search } from 'lucide-react'
import type { RefObject } from 'react'
import { t, type Locale } from '../../i18n'
import type { LauncherItem } from '../../workspace/launcher/types'
import { getPlatformShortcutMeta, supportsParamCustomization } from '../../components/launcher/launcherParamShortcuts'
import { HintKey, LauncherFooter } from './LauncherFooter'
import { LauncherList } from './LauncherList'

export function LauncherSearch({
  inputRef,
  query,
  setQuery,
  items,
  selectedIndex,
  selectItem,
  onPinItem,
  setSelectedIndex,
  isKeyboardNavigation,
  onMouseNavigation,
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
  onPinItem?: (item: LauncherItem) => void
  setSelectedIndex: (index: number) => void
  isKeyboardNavigation: () => boolean
  onMouseNavigation: () => void
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
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>…</span>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[11px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <LauncherList
        items={items}
        selectedIndex={selectedIndex}
        selectItem={selectItem}
        onPinItem={onPinItem}
        setSelectedIndex={setSelectedIndex}
        isKeyboardNavigation={isKeyboardNavigation}
        onMouseNavigation={onMouseNavigation}
        locale={locale}
      />
      <LauncherFooter>
        <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        <HintKey keys="↵" label={t(locale, 'palette.select')} />
        {supportsParamCustomization(items[selectedIndex]) && (
          <HintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
        )}
        <HintKey keys="esc" label={t(locale, 'palette.close')} />
      </LauncherFooter>
    </>
  )
}
