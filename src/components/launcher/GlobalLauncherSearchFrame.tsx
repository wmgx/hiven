import type { MouseEvent as ReactMouseEvent, MutableRefObject, RefObject } from 'react'
import { ArrowLeft, BookmarkPlus, Search, X } from 'lucide-react'
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
  if (item.domainItem.kind === 'dynamic' && item.domainItem.directAnswer) {
    // Computed answers default to copy; dynamic commands still execute.
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
  nearbySaveItem,
  busy = false,
  selectedItem,
  locale,
  showCustomizeHint,
  showWorkflowObjectHint,
  customizeShortcutLabel,
  clipboardBlock,
  onEditMaterial,
  clipboardHintSelected,
  isFavoriteSelected,
  browsingActions = false,
  onBrowseActions,
  onLeaveActionBrowser,
  truncateItems = true,
  onToggleFavorite,
  favoriteKeys,
  pinnableItemKeys,
  onQueryChange,
  onSelectItem,
  onHoverIndex,
  onMouseMove,
  isKeyboardNavRef,
}: {
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  bindSearchInputRef?: (node: HTMLInputElement | HTMLTextAreaElement | null) => void
  query: string
  placeholder: string
  error?: string | null
  items: LauncherMixedItem[]
  nearbySaveItem?: LauncherMixedItem
  busy?: boolean
  selectedItem?: LauncherMixedItem
  locale: Locale
  showCustomizeHint: boolean
  showWorkflowObjectHint: boolean
  customizeShortcutLabel: string
  clipboardBlock?: ClipboardObjectBlockState
  onEditMaterial?: () => void
  clipboardHintSelected?: boolean
  /** Whether the focused row is currently pinned. */
  isFavoriteSelected?: boolean
  browsingActions?: boolean
  onBrowseActions?: () => void
  onLeaveActionBrowser?: () => void
  truncateItems?: boolean
  onToggleFavorite?: (item: LauncherMixedItem) => void
  favoriteKeys?: readonly string[]
  pinnableItemKeys?: ReadonlySet<string>
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
    ? t(locale, 'palette.contentActionPlaceholder')
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
            onRestore={clipboardBlock?.canRestorePreviousMaterial ? () => {
              clipboardBlock.restorePreviousMaterial()
              inputRef.current?.focus()
            } : undefined}
            restoreDisabled={busy}
            onEdit={clipboardBlock?.canEditText ? onEditMaterial : undefined}
            editDisabled={busy}
          />
        )}
        <input
          ref={bindSearchInputRef ?? (inputRef as RefObject<HTMLInputElement | null>)}
          value={query}
          name="launcher-query"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          lang="en"
          autoFocus
          onChange={(event) => onQueryChange(event.target.value)}
          onPaste={(event) => {
            if (block || !clipboardBlock) return
            const pasted = event.clipboardData.getData('text/plain')
            if (!/[\r\n]/.test(pasted)) return
            event.preventDefault()
            const input = event.currentTarget
            clipboardBlock.attachQueryAsBlock(
              query.slice(0, input.selectionStart ?? query.length) + pasted +
              query.slice(input.selectionEnd ?? query.length),
            )
          }}
          placeholder={resolvedPlaceholder}
        />
        {onBrowseActions && query.length > 0 && (
          <button
            type="button"
            className="launcher-query-clear"
            aria-label={t(locale, 'palette.clearQuery')}
            title={t(locale, 'palette.clearQuery')}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            }}
            onClick={() => { onQueryChange(''); inputRef.current?.focus() }}
          >
            <X size={15} aria-hidden />
          </button>
        )}
        {!block && clipboardBlock && query.length > 0 && (
          <button
            type="button"
            className="launcher-query-content-action"
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            }}
            onClick={() => {
              clipboardBlock.attachQueryAsBlock(query)
              inputRef.current?.focus()
            }}
          >
            {t(locale, 'palette.useQueryAsContent')}
          </button>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <div
        className="global-launcher-body l-list"
        data-no-drag
        data-launcher-scrollable
        onMouseMove={onMouseMove}
      >
        {onBrowseActions && (browsingActions || !query.trim() || items.length === 0) && (
          <div className="launcher-discovery-nav">
            <button
              type="button"
              className="launcher-discovery-action"
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
              }}
              onClick={browsingActions ? onLeaveActionBrowser : onBrowseActions}
            >
              {browsingActions && <ArrowLeft size={14} aria-hidden />}
              {t(locale, browsingActions ? 'palette.backToSearch' : 'palette.browseAllActions')}
            </button>
            {browsingActions && <span>{t(locale, 'palette.allActions')}</span>}
          </div>
        )}
        {nearbySaveItem && !query.trim() && !browsingActions && (
          <div className="launcher-discovery-nav">
            <button
              type="button"
              className="launcher-discovery-action"
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
              }}
              onClick={() => onSelectItem(nearbySaveItem)}
            >
              <BookmarkPlus size={14} aria-hidden />
              {nearbySaveItem.title}
            </button>
          </div>
        )}
        {hint && !block && (
          <RecentClipboardHint
            hint={hint}
            selected={Boolean(clipboardHintSelected)}
            locale={locale}
            onAttach={() => clipboardBlock?.attachHintAsBlock()}
          />
        )}
        {items.length === 0 && (query || browsingActions) ? (
          <LauncherEmptyWell
            title={t(locale, 'palette.noResults')}
            hint={t(locale, 'palette.noResultsHint')}
          />
        ) : (
          <LauncherMixedList
              items={items}
              selected={selectedItem}
              locale={locale}
              truncate={truncateItems && !query}
              onToggleFavorite={onToggleFavorite}
              favoriteKeys={favoriteKeys}
              pinnableItemKeys={pinnableItemKeys}
              onSelect={onSelectItem}
              onHoverIndex={onHoverIndex}
              isKeyboardNavRef={isKeyboardNavRef}
            />
        )}
      </div>
      <div className="global-launcher-footer l-foot">
        <div className="l-foot-hints">
          {selectedItem && onToggleFavorite && pinnableItemKeys?.has(selectedItem.id) && (
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
        <button
          type="button"
          className="l-foot-primary grp"
          disabled={!selectedItem || selectedItem.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (selectedItem) onSelectItem(selectedItem)
          }}
        >
          <span className="l-foot-primary-label">{primaryActionLabel(selectedItem, locale)}</span>
          <kbd>↵</kbd>
        </button>
      </div>
    </>
  )
}
