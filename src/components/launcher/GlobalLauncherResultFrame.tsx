import { useEffect, useRef } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { localized } from '../../store'
import type { LauncherControllerState, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherResultChoiceRow } from './LauncherResultChoiceRow'
import { LauncherCommandTag, LauncherParamValueChip } from './LauncherCommandTag'
import { resolveParamValueLabel } from './LauncherParamStep'
import { getHostOutputIntent } from '../../workspace/launcher/output'
import { shouldIgnoreImeKeyDown } from '../../utils/imeKeyboard'
import {
  type OutputDestinationId,
  LauncherOutputTargetsBar,
  LauncherOutputTargetsFooter,
  useOutputDestinations,
} from './LauncherOutputTargets'

function isSingleTextResult(choices: LauncherResultChoice[], explicitPreview = false): boolean {
  if (choices.length !== 1) return false
  const choice = choices[0]
  const text = (choice.preview ?? choice.title ?? '').trim()
  if (!text && !explicitPreview) return false
  // Confirm dialogs use tone danger/muted — keep list UI.
  if (choice.tone === 'danger' || choice.tone === 'muted') return false
  return explicitPreview || getHostOutputIntent(choice) === 'copy' || getHostOutputIntent(choice) === 'return-to-launcher'
}

export function GlobalLauncherResultFrame({
  frame,
  busy = false,
  deliveryIntent,
  error,
  locale,
  selectedIndex,
  selectedChoiceIds,
  onBack,
  onHoverChoice,
  onToggleChoice,
  onSecondaryAction,
  onPastePreviewText,
  canEditPreviewParam,
  onEditPreviewParam,
}: {
  frame: ResultFrame
  busy?: boolean
  deliveryIntent?: LauncherControllerState['deliveryIntent']
  error?: string | null
  locale: Locale
  selectedIndex: number
  selectedChoiceIds: Set<string>
  onBack: () => void
  onHoverChoice: (index: number) => void
  onToggleChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  onPastePreviewText?: (choice: LauncherResultChoice) => void | Promise<void>
  canEditPreviewParam?: (key: string, frame: ResultFrame) => boolean
  onEditPreviewParam?: (key: string, frame: ResultFrame) => void
}) {
  const resultRef = useRef<HTMLDivElement>(null)
  const choices = frame.output.choices
  const selection = frame.output.selection
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, choices.length - 1))
  const selectedCount = selectedChoiceIds.size
  const countLabel = selection?.type === 'multi'
    ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: selection.max })
    : null

  const isConfirmDialog = choices.length <= 3 && choices.some((c) => c.tone === 'danger' || c.tone === 'muted')
  const explicitPreview = frame.executionMode === 'explicit-text-preview'
  const singleText = selection?.type !== 'multi' && (frame.retryOnly || isSingleTextResult(choices, explicitPreview))
  const textChoice = singleText ? choices[0] : undefined
  const previewEdit = explicitPreview && !frame.retryOnly ? frame.previewEdit : undefined
  const previewParams = onEditPreviewParam ? previewEdit?.item.params ?? [] : []
  const hasPreviewParams = previewParams.length > 0

  useEffect(() => {
    if (!hasPreviewParams) return
    const request = requestAnimationFrame(() => resultRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(request)
  }, [frame, hasPreviewParams])
  const rawPreviewText = textChoice ? (textChoice.preview ?? textChoice.title ?? '') : ''
  const previewText = explicitPreview ? rawPreviewText : rawPreviewText.trim()
  const primaryIntent = textChoice ? getHostOutputIntent(textChoice) : null
  const hasIntent = (intent: 'copy' | 'return-to-launcher') => Boolean(textChoice && (
    primaryIntent === intent || textChoice.secondaryActions?.some((action) => getHostOutputIntent(action) === intent)
  ))
  const hasReturn = explicitPreview || primaryIntent === 'return-to-launcher' ? hasIntent('return-to-launcher') : Boolean(textChoice?.secondaryActions?.some((a) => a.id === 'return-to-launcher'))
  const hasCopy = hasIntent('copy')
  const hasPaste = !explicitPreview && !frame.retryOnly && Boolean(onPastePreviewText)
  const {
    destinations,
    activeDest,
    cycle,
    selectId,
    resolveFromKeyboard,
  } = useOutputDestinations({
    hasPaste,
    hasReturn,
    hasCopy,
    primaryIntent: primaryIntent === 'return-to-launcher' ? 'return-to-launcher' : 'copy',
    resetKey: `${frame.sourceTitle ?? ''}:${previewText}`,
  })

  const runDestination = async (destId: OutputDestinationId) => {
    if (!textChoice || busy || frame.retryOnly) return
    if (explicitPreview || primaryIntent === 'return-to-launcher') {
      const intent = destId === 'copy' ? 'copy' : destId === 'return-to-launcher' ? 'return-to-launcher' : null
      if (!intent) return
      if (getHostOutputIntent(textChoice) === intent) onToggleChoice(textChoice, frame)
      else {
        const action = textChoice.secondaryActions?.find((candidate) => getHostOutputIntent(candidate) === intent)
        if (action) onSecondaryAction?.(textChoice, action.id)
      }
      return
    }
    if (destId === 'copy') {
      onToggleChoice(textChoice, frame)
      return
    }
    if (destId === 'paste-foreground') {
      await onPastePreviewText?.(textChoice)
      return
    }
    if (destId === 'return-to-launcher') {
      onSecondaryAction?.(textChoice, 'return-to-launcher')
    }
  }

  if (singleText && textChoice) {
    return (
      <div
        ref={resultRef}
        className="launcher-result-text-frame"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (shouldIgnoreImeKeyDown(event, { current: false })) return
          if (hasPreviewParams && (
            event.key === 'Tab'
            || ((event.key === 'Enter' || event.key === ' ' || event.code === 'Space')
              && event.target instanceof HTMLElement && event.target.closest('button'))
          )) {
            // Every parameter and output remains reachable by native Tab;
            // focused buttons own Enter / Space instead of executing output.
            event.stopPropagation()
            return
          }
          if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault()
            event.stopPropagation()
            cycle(event.shiftKey ? -1 : 1)
            return
          }
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.stopPropagation()
          if (busy) return
          if (frame.retryOnly) {
            if (!event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) onToggleChoice(textChoice, frame)
            return
          }
          if (explicitPreview && (event.shiftKey || event.altKey)) return
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
        {hasPreviewParams && previewEdit && (
          <div
            className="launcher-preview-params"
            data-testid="launcher-preview-params"
            data-no-drag
            data-launcher-scrollable
            role="group"
            aria-label={t(locale, 'palette.customizeParamsLabel')}
          >
            {previewParams.map((param) => {
              const label = localized(param.label, param.labelI18n, locale)
              return (
                <LauncherParamValueChip
                  key={param.key}
                  paramKey={param.key}
                  label={label}
                  value={resolveParamValueLabel(param, previewEdit.params[param.key], locale)}
                  editLabel={t(locale, 'palette.editPreviewParam', { label })}
                  disabled={busy || !canEditPreviewParam?.(param.key, frame)}
                  onEdit={() => onEditPreviewParam?.(param.key, frame)}
                />
              )
            })}
          </div>
        )}
        <div
          className="launcher-preview-well"
          data-testid="launcher-result-preview-well"
          data-no-drag
          data-launcher-scrollable
          aria-live="polite"
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <pre
            tabIndex={0}
            aria-label={t(locale, 'palette.preview')}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault()
                event.stopPropagation()
                const range = document.createRange()
                const sel = window.getSelection()
                const node = event.currentTarget.querySelector('.launcher-preview-text')
                if (node && sel) {
                  range.selectNodeContents(node)
                  sel.removeAllRanges()
                  sel.addRange(range)
                }
              }
            }}
          >
            <span className="launcher-preview-text">{previewText}</span>
            {explicitPreview && previewText.length === 0 ? (
              <span className="meta">{t(locale, 'palette.emptyTextOutput')}</span>
            ) : null}
          </pre>
        </div>
        {frame.retryOnly ? (
          <button
            type="button"
            className="launcher-output-target"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.stopPropagation()
              if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) event.preventDefault()
            }}
            onClick={() => onToggleChoice(textChoice, frame)}
          >
            {t(locale, 'palette.outputRetry')}
          </button>
        ) : <LauncherOutputTargetsBar
          disabled={busy}
          destinations={destinations}
          activeId={activeDest?.id ?? 'copy'}
          locale={locale}
          onSelect={(id) => {
            selectId(id)
            void runDestination(id)
          }}
        />}
        {busy && <span role="status" aria-live="polite">{t(locale, deliveryIntent === 'copy' ? 'palette.outputCopying' : 'palette.outputDelivering')}</span>}
        {error && (
          <div role="alert" className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
            {error}
          </div>
        )}
        <div className="global-launcher-footer l-foot">
          {frame.retryOnly
            ? <LauncherHintKey keys="↵" label={t(locale, 'palette.outputRetry')} />
            : hasPreviewParams
              ? <LauncherHintKey keys="⇥" label={t(locale, 'palette.previewParamNavigation')} />
              : <LauncherOutputTargetsFooter destinations={destinations} locale={locale} />}
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
          const disabled = busy || (selection?.type === 'multi' && selectedCount >= selection.max && !checked)
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
      {busy && <span role="status" aria-live="polite">{t(locale, deliveryIntent === 'copy' ? 'palette.outputCopying' : 'palette.outputDelivering')}</span>}
      {error && (
        <div role="alert" className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
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
