import { WindowFeedback } from '../../ui/WindowFeedback'
import type { LauncherSearchRecovery } from '../../workspace/launcher/searchRecovery'
import { useLayoutEffect, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefObject } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { LauncherHintKey } from './LauncherFooterHints'
import { LauncherMixedList, type LauncherMixedItem } from './LauncherMixedList'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import { ObjectBlockToken } from './ObjectBlockToken'
import { RecentClipboardHint } from './RecentClipboardHint'
import { LauncherEmptyWell } from './LauncherEmptyWell'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'
import { FILE_TEXT_ERROR_KEYS } from '../../launcher/clipboard/fileTextMaterial'
import { shouldPasteAsBlock } from '../../launcher/clipboard/attachPolicy'
import { LauncherAutoGrowInput, measureWrappedLines } from './LauncherAutoGrowInput'
import type { LauncherBrowseCategory } from '../../workspace/launcher/browseItems'

const BROWSE_CATEGORIES = [
  { id: 'all', label: 'palette.browseAll' },
  { id: 'tools', label: 'palette.browseTools' },
  { id: 'apps', label: 'palette.browseApps' },
  { id: 'system', label: 'palette.browseSystem' },
] as const

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
  searchRecovery,
  placeholder,
  searchContext,
  error,
  items,
  busy = false,
  selectedItem,
  locale,
  clipboardBlock,
  clipboardHintSelected,
  isFavoriteSelected,
  browsingActions = false,
  browseCategory = 'all',
  onBrowseCategoryChange,
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
  searchRecovery?: LauncherSearchRecovery
  placeholder: string
  searchContext?: string
  error?: string | null
  items: LauncherMixedItem[]
  busy?: boolean
  selectedItem?: LauncherMixedItem
  locale: Locale
  clipboardBlock?: ClipboardObjectBlockState
  clipboardHintSelected?: boolean
  /** Whether the focused row is currently pinned. */
  isFavoriteSelected?: boolean
  browsingActions?: boolean
  browseCategory?: LauncherBrowseCategory
  onBrowseCategoryChange?: (category: LauncherBrowseCategory) => void
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
}) {
  const block = clipboardBlock?.block ?? null
  const blockExiting = Boolean(clipboardBlock?.isExiting)
  const hint = clipboardBlock?.hint ?? null
  const fileTextBusy = Boolean(clipboardBlock?.isReadingFileText)
  const [focusedControl, setFocusedControl] = useState<{
    element: HTMLButtonElement
    label: string
    action?: string
    itemId?: string
  } | null>(null)
  const updateFocusedControl = (target: EventTarget | null) => {
    const button = target instanceof HTMLElement ? target.closest('button') : null
    const favoriteButton = button?.classList.contains('launcher-row-pin')
    const rowIndex = button?.closest<HTMLElement>('[data-launcher-row-index]')?.dataset.launcherRowIndex
    setFocusedControl(button ? {
      element: button,
      label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
      action: button.hasAttribute('data-launcher-primary-action') ? 'primary'
        : favoriteButton ? 'favorite' : button.dataset.launcherFocusAction,
      itemId: favoriteButton && rowIndex !== undefined ? items[Number(rowIndex)]?.id : undefined,
    } : null)
  }
  const handleFocus = (event: ReactFocusEvent<HTMLElement>) => updateFocusedControl(event.target)
  const handleBlur = (event: ReactFocusEvent<HTMLElement>) => {
    const target = event.relatedTarget
    updateFocusedControl(target instanceof Node && event.currentTarget.parentElement?.contains(target) ? target : null)
  }
  useLayoutEffect(() => {
    // Async file completion can remove a focused read/cancel button without
    // firing blur. Restore the query before leaving a stale Enter hint behind.
    if (focusedControl && !focusedControl.element.isConnected) inputRef.current?.focus()
  })
  const focusedActionLabel = focusedControl?.action === 'browse'
      ? t(locale, browsingActions ? 'palette.backToSearch' : 'palette.browseAllActions')
      : focusedControl?.action === 'favorite'
        ? t(locale, focusedControl.itemId && favoriteKeys?.includes(focusedControl.itemId) ? 'palette.actionUnpin' : 'palette.actionPin')
        : focusedControl?.label
  const showListHints = !focusedControl && !fileTextBusy
  // Keep placeholder stable during exit to avoid input layout shift mid-animation.
  const resolvedPlaceholder = block
    ? t(locale, 'palette.contentActionPlaceholder')
    : placeholder

  return (
    <>
      <div
        className="global-launcher-header l-search"
        data-launcher-drag-handle
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
        style={{ borderBottom: '1px solid var(--border)' }}
        title={undefined}
      >
        <Search className="ico" aria-hidden />
        {block && (
          <ObjectBlockToken
            block={block}
            locale={locale}
            exiting={blockExiting}
            onRemove={() => {
              clipboardBlock?.removeBlock()
              inputRef.current?.focus()
            }}
          />
        )}
        <LauncherAutoGrowInput
          ref={bindSearchInputRef ?? (inputRef as RefObject<HTMLTextAreaElement | null>)}
          value={query}
          name="launcher-query"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          lang="en"
          autoFocus
          onChange={onQueryChange}
          onPaste={(event) => {
            if (block || !clipboardBlock) return
            const pasted = event.clipboardData.getData('text/plain')
            const input = event.currentTarget
            if (!shouldPasteAsBlock(pasted, measureWrappedLines(input, pasted))) return
            event.preventDefault()
            clipboardBlock.attachQueryAsBlock(
              query.slice(0, input.selectionStart ?? query.length) + pasted +
              query.slice(input.selectionEnd ?? query.length),
            )
          }}
          placeholder={resolvedPlaceholder}
        />
        {searchContext ? <span className="meta whitespace-nowrap">{searchContext}</span> : null}
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
      </div>
      <WindowFeedback mode="error" />
      <div
        className="global-launcher-body l-list"
        data-no-drag
        data-launcher-scrollable
        data-control-focused={focusedControl && focusedControl.action !== 'primary' ? 'true' : undefined}
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
        onMouseMove={onMouseMove}
      >
        {hint && !block && (
          <RecentClipboardHint
            hint={hint}
            selected={Boolean(clipboardHintSelected)}
            locale={locale}
            onActivate={() => clipboardBlock?.activateHint()}
            onDismiss={() => clipboardBlock?.dismissHint()}
            onSelect={() => onHoverIndex(-1)}
          />
        )}
        {clipboardBlock && (clipboardBlock.canReadFileText || fileTextBusy) && (
          <div
            className="launcher-file-material-status"
            aria-busy={fileTextBusy}
          >
            {fileTextBusy && (
              <span role="status">
                {t(locale, 'palette.fileTextReading')}
              </span>
            )}
            {clipboardBlock.canReadFileText && !clipboardBlock.isReadingFileText && (
              <button
                type="button"
                className="launcher-discovery-action"
                disabled={busy || fileTextBusy}
                onMouseDown={(event) => event.preventDefault()}
                onKeyDown={(event) => event.stopPropagation()}
                onKeyUp={(event) => event.stopPropagation()}
                onClick={() => clipboardBlock.readFileText()}
              >
                {t(locale, 'palette.fileTextRead')}
              </button>
            )}
            {clipboardBlock.isReadingFileText && (
                <button
                  type="button"
                  className="launcher-discovery-action"
                  onMouseDown={(event) => event.preventDefault()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onKeyUp={(event) => event.stopPropagation()}
                  onClick={clipboardBlock.cancelFileTextRead}
                >
                  {t(locale, 'palette.fileTextCancel')}
                </button>
            )}
          </div>
        )}
        {clipboardBlock?.fileTextError && (
          <div className="launcher-file-material-error px-3.5 py-1.5 text-[12px]" role="alert" style={{ color: 'var(--color-error)' }}>
            {t(locale, FILE_TEXT_ERROR_KEYS[clipboardBlock.fileTextError])}
          </div>
        )}
        {error && (
          <div className="px-3.5 py-1.5 text-[12px]" role="alert" style={{ color: 'var(--color-error)', borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}>
            {error}
          </div>
        )}
        {onBrowseActions && (browsingActions || !query.trim() || items.length === 0) && (
          <div className="launcher-discovery-nav">
            <button
              type="button"
              className="launcher-discovery-action"
              data-launcher-focus-action="browse"
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
              }}
              onClick={browsingActions ? onLeaveActionBrowser : onBrowseActions}
            >
              {browsingActions && <ArrowLeft size={14} aria-hidden />}
              {t(locale, browsingActions ? 'palette.backToSearch' : 'palette.browseAllActions')}
            </button>
            {browsingActions && onBrowseCategoryChange && (
              <div
                className="launcher-discovery-categories"
                role="group"
                aria-label={t(locale, 'palette.browseCategories')}
              >
                {BROWSE_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className="launcher-discovery-action launcher-discovery-category"
                    data-launcher-focus-action="browse-category"
                    data-launcher-browse-category={category.id}
                    aria-pressed={browseCategory === category.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                    }}
                    onClick={() => onBrowseCategoryChange(category.id)}
                  >
                    {t(locale, category.label)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {items.length === 0 && (query || browsingActions) ? (
          <LauncherEmptyWell
            title={t(locale, !browsingActions && searchRecovery?.failed ? 'palette.searchTemporarilyUnavailable' : 'palette.noResults')}
            hint={!browsingActions && searchRecovery?.failed ? undefined : t(locale, browsingActions ? 'palette.browseEmptyHint' : 'palette.noResultsHint')}
            action={!browsingActions && searchRecovery?.failed ? <button type="button" aria-disabled={searchRecovery.pending}
              onMouseDown={event => event.preventDefault()}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}
              onClick={() => { if (!searchRecovery.pending) searchRecovery.retry(); inputRef.current?.focus({ preventScroll: true }) }}>
              {t(locale, searchRecovery.pending ? 'palette.searchRetrying' : 'palette.searchRetry')}
            </button> : undefined}
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
      {!query.trim() && !browsingActions && !hint && !block && (
        <div className="launcher-clipboard-explanation">{t(locale, 'palette.clipboardExplanation')}</div>
      )}
      <div className="global-launcher-footer l-foot" onFocusCapture={handleFocus} onBlurCapture={handleBlur}>
        <div className="l-foot-hints">
          <WindowFeedback mode="status" />
          {showListHints && selectedItem?.domainItem.executeWithParams && selectedItem.domainItem.params?.length ? (
            <LauncherHintKey keys="⇥" label={t(locale, 'palette.customizeParamsLabel')} />
          ) : null}
          {showListHints && selectedItem && onToggleFavorite && pinnableItemKeys?.has(selectedItem.id) && (
            <LauncherHintKey
              keys={`${getPlatformShortcutMeta().label}P`}
              label={isFavoriteSelected ? t(locale, 'palette.actionUnpin') : t(locale, 'palette.actionPin')}
            />
          )}
          <LauncherHintKey keys="esc" label={t(locale, browsingActions ? 'palette.back' : 'palette.close')} />
          {focusedControl && focusedControl.action !== 'primary' &&
            focusedActionLabel && !(focusedControl.action === 'file' && fileTextBusy) && (
            <span className="launcher-focused-action grp" title={focusedActionLabel}>
              <kbd>↵</kbd>
              <span>{focusedActionLabel}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="l-foot-primary grp"
          data-launcher-primary-action
          data-secondary={!showListHints && focusedControl?.action !== 'primary' ? 'true' : undefined}
          disabled={!selectedItem || selectedItem.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (selectedItem) onSelectItem(selectedItem)
          }}
        >
          <span className="l-foot-primary-label">{primaryActionLabel(selectedItem, locale)}</span>
          {(showListHints || focusedControl?.action === 'primary') && <kbd>↵</kbd>}
        </button>
      </div>
    </>
  )
}
