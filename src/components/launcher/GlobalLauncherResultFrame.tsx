import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherResultChoiceRow } from './LauncherResultChoiceRow'
import { LauncherCommandTag } from './LauncherCommandTag'
import {
  type OutputDestinationId,
  LauncherOutputTargetsBar,
  LauncherOutputTargetsFooter,
  useOutputDestinations,
} from './LauncherOutputTargets'

function isSingleTextResult(choices: LauncherResultChoice[]): boolean {
  if (choices.length !== 1) return false
  const choice = choices[0]
  const text = (choice.preview ?? choice.title ?? '').trim()
  if (!text) return false
  // Confirm dialogs use tone danger/muted — keep list UI.
  if (choice.tone === 'danger' || choice.tone === 'muted') return false
  return true
}

export function GlobalLauncherResultFrame({
  frame,
  error,
  locale,
  selectedIndex,
  selectedChoiceIds,
  onBack,
  onHoverChoice,
  onToggleChoice,
  onSecondaryAction,
  onPastePreviewText,
}: {
  frame: ResultFrame
  error?: string | null
  locale: Locale
  selectedIndex: number
  selectedChoiceIds: Set<string>
  onBack: () => void
  onHoverChoice: (index: number) => void
  onToggleChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  onPastePreviewText?: (text: string) => void | Promise<void>
}) {
  const choices = frame.output.choices
  const selection = frame.output.selection
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, choices.length - 1))
  const selectedCount = selectedChoiceIds.size
  const countLabel = selection?.type === 'multi'
    ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: selection.max })
    : null

  const isConfirmDialog = choices.length <= 3 && choices.some((c) => c.tone === 'danger' || c.tone === 'muted')
  const singleText = isSingleTextResult(choices)
  const textChoice = singleText ? choices[0] : undefined
  const previewText = textChoice ? (textChoice.preview ?? textChoice.title ?? '').trim() : ''
  const hasReturn = Boolean(textChoice?.secondaryActions?.some((a) => a.id === 'return-to-launcher'))
  const hasPaste = Boolean(onPastePreviewText)
  const {
    destinations,
    metaLabel,
    activeDest,
    cycle,
    selectId,
    resolveFromKeyboard,
  } = useOutputDestinations({
    hasPaste,
    hasReturn,
    resetKey: `${frame.sourceTitle ?? ''}:${previewText}`,
  })

  const runDestination = async (destId: OutputDestinationId) => {
    if (!textChoice) return
    if (destId === 'copy') {
      onToggleChoice(textChoice, frame)
      return
    }
    if (destId === 'paste-foreground') {
      await onPastePreviewText?.(previewText)
      return
    }
    if (destId === 'return-to-launcher') {
      onSecondaryAction?.(textChoice, 'return-to-launcher')
    }
  }

  if (singleText && textChoice) {
    return (
      <div
        className="launcher-result-text-frame"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault()
            event.stopPropagation()
            cycle(event.shiftKey ? -1 : 1)
            return
          }
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.stopPropagation()
          void runDestination(resolveFromKeyboard(event))
        }}
      >
        <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
          <LauncherCommandTag
            title={frame.sourceTitle || textChoice.title}
            locale={locale}
            onRemove={onBack}
          />
        </div>
        <div
          className="launcher-preview-well"
          data-testid="launcher-result-preview-well"
          data-no-drag
          data-launcher-scrollable
          aria-live="polite"
        >
          <pre>{previewText}</pre>
        </div>
        <LauncherOutputTargetsBar
          destinations={destinations}
          activeId={activeDest?.id ?? 'copy'}
          locale={locale}
          onSelect={(id) => {
            selectId(id)
            void runDestination(id)
          }}
        />
        {error && (
          <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
            {error}
          </div>
        )}
        <div className="global-launcher-footer l-foot">
          <LauncherOutputTargetsFooter
            destinations={destinations}
            locale={locale}
            metaLabel={metaLabel}
            hasPaste={hasPaste}
            hasReturn={hasReturn}
          />
          <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <LauncherCommandTag
          title={frame.sourceTitle || t(locale, 'palette.confirm')}
          locale={locale}
          onRemove={onBack}
        />
      </div>
      <div className={`global-launcher-body l-results ${isConfirmDialog ? 'l-results-confirm' : ''}`}>
        {choices.map((choice, index) => {
          const checked = selectedChoiceIds.has(choice.id)
          const disabled = selection?.type === 'multi' && selectedCount >= selection.max && !checked
          return (
            <LauncherResultChoiceRow
              key={choice.id}
              choice={choice}
              index={index}
              selected={index === clampedSelectedIndex}
              checked={checked}
              disabled={disabled}
              multi={selection?.type === 'multi'}
              locale={locale}
              onHover={() => onHoverChoice(index)}
              onSelect={() => onToggleChoice(choice, frame)}
            />
          )
        })}
      </div>
      {error && (
        <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      <div className="global-launcher-footer l-foot">
        {countLabel && <LauncherHintText label={countLabel} />}
        <LauncherHintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        {selection?.type === 'multi'
          ? <LauncherHintKey keys="␣" label={t(locale, 'palette.select')} />
          : <LauncherHintKey keys="↵" label={t(locale, 'palette.confirm')} />
        }
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
