import { useState, type RefObject } from 'react'
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
  onExecuteAction,
}: {
  inputRef: RefObject<HTMLInputElement | null>
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
  onExecuteAction?: (action: RecommendedAction, target: RecommendedOutputTarget) => void
}) {
  const block = clipboardBlock?.block ?? null
  const hint = clipboardBlock?.hint ?? null
  const resolvedPlaceholder = block ? t(locale, 'palette.objectActionPlaceholder') : placeholder
  const recommendedActions: RecommendedAction[] = block ? recommendActionsForBlock(block) : []
  const [expandedAction, setExpandedAction] = useState<RecommendedAction | null>(null)
  const [targetIndex, setTargetIndex] = useState(0)

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
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={resolvedPlaceholder}
        />
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      {hint && !block && (
        <RecentClipboardHint
          hint={hint}
          onAttach={() => clipboardBlock?.attachHintAsBlock()}
        />
      )}
      <div className="global-launcher-body l-list" onMouseMove={onMouseMove}>
        {block && recommendedActions.length > 0 && !query ? (
          <div className="recommended-actions-list" data-testid="recommended-actions-list">
            {expandedAction ? (
              <OutputTargetExpansion
                action={expandedAction}
                selectedIndex={targetIndex}
                onSelect={(target) => { onExecuteAction?.(expandedAction, target); setExpandedAction(null) }}
                onHover={setTargetIndex}
                onBack={() => setExpandedAction(null)}
              />
            ) : (
              recommendedActions.map((action, index) => (
                <RecommendedActionRow
                  key={action.id}
                  action={action}
                  selected={index === 0}
                  onSelect={() => onExecuteAction?.(action, action.defaultOutput)}
                  onHover={() => {}}
                />
              ))
            )}
          </div>
        ) : (
          <LauncherMixedList
            items={items}
            selected={selectedItem}
            locale={locale}
            onSelect={onSelectItem}
            onHoverIndex={onHoverIndex}
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
