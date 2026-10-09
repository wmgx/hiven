import { useLayoutEffect, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefObject } from 'react'
import { ArrowLeft, BookmarkPlus, FilePlus2, Search, X } from 'lucide-react'
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
import { FILE_TEXT_ERROR_KEYS } from '../../launcher/clipboard/fileTextMaterial'

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
  onRenameSavedAction,
  onDeleteSavedAction,
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
  onRenameSavedAction?: (item: LauncherMixedItem) => void
  onDeleteSavedAction?: (item: LauncherMixedItem) => void
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
  const fileTextBusy = Boolean(clipboardBlock?.isPickingTextFile || clipboardBlock?.isReadingFileText)
  const fileActionLabel = t(locale, block ? 'palette.fileTextReplace' : 'palette.fileTextPick')
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
  const focusedActionLabel = focusedControl?.action === 'file'
    ? fileActionLabel
    : focusedControl?.action === 'browse'
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
        {clipboardBlock?.canPickTextFile && (
          <button
            type="button"
            className="launcher-query-clear launcher-file-material-action"
            data-launcher-focus-action="file"
            aria-label={fileActionLabel}
            title={fileActionLabel}
            disabled={busy || fileTextBusy}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            onClick={clipboardBlock.pickTextFile}
          >
            <FilePlus2 size={16} aria-hidden />
          </button>
        )}
      </div>
      <div
        className="global-launcher-body l-list"
        data-no-drag
        data-launcher-scrollable
        data-control-focused={focusedControl && focusedControl.action !== 'primary' ? 'true' : undefined}
        onFocusCapture={handleFocus}
        onBlurCapture={handleBlur}
        onMouseMove={onMouseMove}
      >
        {clipboardBlock && (clipboardBlock.canReadFileText || fileTextBusy) && (
          <div
            className="launcher-file-material-status"
            aria-busy={fileTextBusy}
          >
            {fileTextBusy && (
              <span role="status">
                {t(locale, clipboardBlock.isPickingTextFile ? 'palette.fileTextPicking' : 'palette.fileTextReading')}
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
                onClick={clipboardBlock.readFileText}
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
          <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}>
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
              onRenameSavedAction={onRenameSavedAction}
              onDeleteSavedAction={onDeleteSavedAction}
              favoriteKeys={favoriteKeys}
              pinnableItemKeys={pinnableItemKeys}
              onSelect={onSelectItem}
              onHoverIndex={onHoverIndex}
              isKeyboardNavRef={isKeyboardNavRef}
            />
        )}
      </div>
      <div className="global-launcher-footer l-foot" onFocusCapture={handleFocus} onBlurCapture={handleBlur}>
        <div className="l-foot-hints">
          {showListHints && selectedItem && onToggleFavorite && pinnableItemKeys?.has(selectedItem.id) && (
            <LauncherHintKey
              keys={`${getPlatformShortcutMeta().label}P`}
              label={isFavoriteSelected ? t(locale, 'palette.actionUnpin') : t(locale, 'palette.actionPin')}
            />
          )}
          {showListHints && showCustomizeHint && (
            <LauncherHintKey keys={`${customizeShortcutLabel}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
          )}
          {showListHints && showWorkflowObjectHint && (
            <LauncherHintKey keys="tab" label={t(locale, 'palette.select')} />
          )}
          <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
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
