import type { MouseEvent as ReactMouseEvent, MutableRefObject, RefObject } from 'react'
import { Search } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { LauncherHintKey } from './LauncherFooterHints'
import { LauncherMixedList, type LauncherMixedItem } from './LauncherMixedList'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import { ObjectBlockToken } from './ObjectBlockToken'
import { RecentClipboardHint } from './RecentClipboardHint'
import type { RecommendedAction, RecommendedOutputTarget } from '../../launcher/clipboard/actionRecommendation'
import { LauncherEmptyWell } from './LauncherEmptyWell'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'

function primaryActionLabel(item: LauncherMixedItem | undefined, locale: Locale): string {
  if (!item || item.kind !== 'domain') return t(locale, 'palette.actionRun')
  const key = item.domainItem.systemKey
  if (key.startsWith('host:app-launcher:app:') || key.startsWith('host.app:')) {
    return t(locale, 'palette.actionOpen')
  }
  if (item.domainItem.kind === 'dynamic') {
    // Calculator / instant results default to copy
    return t(locale, 'palette.actionCopy')
  }
  return t(locale, 'palette.actionRun')
}

export function GlobalLauncherSearchFrame({
  inputRef,
  bindSearchInputRef,
  query,
  placeholder,
  error,
  items,
  selectedItem,
  locale,
  showCustomizeHint,
  showWorkflowObjectHint,
  customizeShortcutLabel,
  clipboardBlock,
  clipboardHintSelected,
  isFavoriteSelected,
  onQueryChange,
  onSelectItem,
  onHoverIndex,
  onMouseMove,
  isKeyboardNavRef,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  bindSearchInputRef?: (node: HTMLInputElement | null) => void
  query: string
  placeholder: string
  error?: string | null
  items: LauncherMixedItem[]
  selectedItem?: LauncherMixedItem
  locale: Locale
  showCustomizeHint: boolean
  showWorkflowObjectHint: boolean
  customizeShortcutLabel: string
  clipboardBlock?: ClipboardObjectBlockState
  clipboardHintSelected?: boolean
  /** Whether the focused row is currently pinned. */
  isFavoriteSelected?: boolean
  onQueryChange: (value: string) => void
  onSelectItem: (item: LauncherMixedItem) => void
  onHoverIndex: (index: number) => void
  onMouseMove: (event: ReactMouseEvent) => void
  isKeyboardNavRef?: MutableRefObject<boolean>
  /** @deprecated Dedicated object-action rows removed; ranking + textMatch is the path. */
  onExecuteAction?: (action: RecommendedAction, target: RecommendedOutputTarget) => void
  selectedActionIndex?: number
  onSelectedActionIndexChange?: (index: number) => void
  onObjectActionController?: (controller: { expand: () => void; execute: (keepOpen?: boolean) => void } | null) => void
}) {
  const block = clipboardBlock?.block ?? null
  const blockExiting = Boolean(clipboardBlock?.isExiting)
  const hint = clipboardBlock?.hint ?? null
  // Keep placeholder stable during exit to avoid input layout shift mid-animation.
  const resolvedPlaceholder = block
    ? t(locale, 'palette.objectActionPlaceholder', { source: block.title })
    : placeholder

  return (
    <>
      <div
        className="global-launcher-header l-search"
        data-launcher-drag-handle
        style={{ borderBottom: '1px solid var(--border)' }}
        title={undefined}
      >
        <Search className="ico" aria-hidden />
        {block && (
          <ObjectBlockToken
            block={block}
            locale={locale}
            exiting={blockExiting}
            onRemove={() => clipboardBlock?.removeBlock()}
          />
        )}
        <input
          ref={bindSearchInputRef ?? inputRef}
          value={query}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          lang="en"
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={resolvedPlaceholder}
        />
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <div className="global-launcher-body l-list" onMouseMove={onMouseMove}>
        {hint && !block && (
          <RecentClipboardHint
            hint={hint}
            selected={Boolean(clipboardHintSelected)}
            locale={locale}
            onAttach={() => clipboardBlock?.attachHintAsBlock()}
          />
        )}
        {items.length === 0 && query ? (
          <LauncherEmptyWell
            title={t(locale, 'palette.noResults')}
            hint={t(locale, 'palette.noResultsHint')}
          />
        ) : (
          <LauncherMixedList
              items={items}
              selected={selectedItem}
              locale={locale}
              truncate={!query}
              onSelect={onSelectItem}
              onHoverIndex={onHoverIndex}
              isKeyboardNavRef={isKeyboardNavRef}
            />
        )}
      </div>
      <div className="global-launcher-footer l-foot">
        <div className="l-foot-hints">
          {selectedItem && (
            <LauncherHintKey
              keys={`${getPlatformShortcutMeta().label}P`}
              label={isFavoriteSelected ? t(locale, 'palette.actionUnpin') : t(locale, 'palette.actionPin')}
            />
          )}
          {showCustomizeHint && (
            <LauncherHintKey keys={`${customizeShortcutLabel}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
          )}
          {showWorkflowObjectHint && (
            <LauncherHintKey keys="tab" label={t(locale, 'palette.select')} />
          )}
          <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
        </div>
        {/* SuperCmd/Tinycast action capsule: primary action + ↵, not a keycap manual */}
        <span className="l-foot-primary grp">
          <span className="l-foot-primary-label">{primaryActionLabel(selectedItem, locale)}</span>
          <kbd>↵</kbd>
        </span>
      </div>
    </>
  )
}
