import type { MutableRefObject, RefObject } from 'react'
import { Search } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { LauncherHintKey } from './LauncherFooterHints'
import { LauncherMixedList, type LauncherMixedItem } from './LauncherMixedList'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import { ObjectBlockToken } from './ObjectBlockToken'
import { RecentClipboardHint } from './RecentClipboardHint'
import type { RecommendedAction, RecommendedOutputTarget } from '../../launcher/clipboard/actionRecommendation'

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
  onQueryChange: (value: string) => void
  onSelectItem: (item: LauncherMixedItem) => void
  onHoverIndex: (index: number) => void
  onMouseMove: () => void
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
  // During exit, drop action placeholder immediately so the bar doesn't feel stuck on object mode.
  const resolvedPlaceholder = block && !blockExiting
    ? t(locale, 'palette.objectActionPlaceholder', { source: block.title })
    : placeholder

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <Search className="ico" />
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
          inputMode="latin"
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
          <div className="flex-1 flex items-center justify-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
            <span className="text-[13px]">{t(locale, 'palette.noResults')}</span>
          </div>
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
        <LauncherHintKey keys="↑↓" label={t(locale, 'palette.select')} />
        <LauncherHintKey keys="↵" label={t(locale, 'palette.confirm')} />
        {showCustomizeHint && (
          <LauncherHintKey keys={`${customizeShortcutLabel}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
        )}
        {showWorkflowObjectHint && (
          <LauncherHintKey keys="tab" label={t(locale, 'palette.select')} />
        )}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
