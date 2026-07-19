import { useEffect, useMemo, useState, type MutableRefObject, type RefObject } from 'react'
import { Search } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { LauncherHintKey } from './LauncherFooterHints'
import { LauncherMixedList, type LauncherMixedItem } from './LauncherMixedList'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import { ObjectBlockToken } from './ObjectBlockToken'
import { RecentClipboardHint } from './RecentClipboardHint'
import { RecommendedActionRow } from './RecommendedActionRow'
import { OutputTargetExpansion } from './OutputTargetExpansion'
import { recommendActionsForBlock, type RecommendedAction, type RecommendedOutputTarget } from '../../launcher/clipboard/actionRecommendation'

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
  onQueryChange,
  onSelectItem,
  onHoverIndex,
  onMouseMove,
  isKeyboardNavRef,
  onExecuteAction,
  selectedActionIndex = 0,
  onSelectedActionIndexChange,
  onObjectActionController,
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
  onQueryChange: (value: string) => void
  onSelectItem: (item: LauncherMixedItem) => void
  onHoverIndex: (index: number) => void
  onMouseMove: () => void
  isKeyboardNavRef?: MutableRefObject<boolean>
  onExecuteAction?: (action: RecommendedAction, target: RecommendedOutputTarget) => void
  selectedActionIndex?: number
  onSelectedActionIndexChange?: (index: number) => void
  onObjectActionController?: (controller: { expand: () => void; execute: (keepOpen?: boolean) => void } | null) => void
}) {
  const block = clipboardBlock?.block ?? null
  const hint = clipboardBlock?.hint ?? null
  const resolvedPlaceholder = block
    ? t(locale, 'palette.objectActionPlaceholder', { source: block.title })
    : placeholder
  const recommendedActions: RecommendedAction[] = [] // Disabled: recommendations now come from plugin dynamicItems + textMatch
  const [expandedAction, setExpandedAction] = useState<RecommendedAction | null>(null)
  const [targetIndex, setTargetIndex] = useState(0)

  // Filter recommended actions by query when in object-action mode
  const filteredActions = useMemo(() => {
    if (!query) return recommendedActions
    const lowerQuery = query.toLowerCase()
    return recommendedActions.filter((action) =>
      action.title.toLowerCase().includes(lowerQuery) ||
      action.titleZh.toLowerCase().includes(lowerQuery) ||
      action.id.toLowerCase().includes(lowerQuery) ||
      (action.subtitle?.toLowerCase().includes(lowerQuery) ?? false) ||
      (action.provider?.toLowerCase().includes(lowerQuery) ?? false)
    )
  }, [recommendedActions, query])

  const activeAction = filteredActions[Math.min(selectedActionIndex, Math.max(0, filteredActions.length - 1))]

  // Clamp selected action index when filtered list changes
  useEffect(() => {
    if (filteredActions.length > 0 && selectedActionIndex >= filteredActions.length) {
      onSelectedActionIndexChange?.(Math.max(0, filteredActions.length - 1))
    }
  }, [filteredActions.length, selectedActionIndex, onSelectedActionIndexChange])

  useEffect(() => {
    if (!block || !activeAction) {
      onObjectActionController?.(null)
      return
    }
    onObjectActionController?.({
      expand: () => { setExpandedAction(activeAction); setTargetIndex(0) },
      execute: (keepOpen = false) => onExecuteAction?.(activeAction, keepOpen ? 'copy-and-keep-open' : activeAction.defaultOutput),
    })
    return () => onObjectActionController?.(null)
  }, [activeAction, block, onExecuteAction, onObjectActionController])

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <Search className="ico" />
        {block && (
          <ObjectBlockToken
            block={block}
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
        <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <div className="global-launcher-body l-list" onMouseMove={onMouseMove}>
        {hint && !block && (
          <RecentClipboardHint
            hint={hint}
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
