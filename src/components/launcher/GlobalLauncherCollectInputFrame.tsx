import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { CornerDownLeft, History } from 'lucide-react'
// note: lastPreviewRef keeps display text across brief controller gaps
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { getHostOutputIntent } from '../../workspace/launcher/output'
import { showToast } from '../../workspace/toast'
import type { CollectInputFrame, LauncherControllerState } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { IconRef, LauncherOutput, LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'
import { Tooltip } from '../Tooltip'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherCommandTag, LauncherParamChipTrail } from './LauncherCommandTag'
import { LauncherEmptyWell } from './LauncherEmptyWell'
import { shouldIgnoreImeKeyDown } from '../../utils/imeKeyboard'
import { reconcileMaterialTextInput } from '../../launcher/clipboard/currentMaterial'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'
import {
  type OutputDestinationId,
  LauncherOutputTargetsBar,
  LauncherOutputTargetsFooter,
  useOutputDestinations,
} from './LauncherOutputTargets'

/** Suggest row: keep keyboard highlight in view (same as result / mixed list). */
function CollectInputSuggestRow({
  choice,
  selected,
  fallbackIcon,
  disabled,
  onActivateChoice,
  onSecondaryAction,
}: {
  choice: LauncherResultChoice
  selected: boolean
  fallbackIcon?: IconRef
  disabled?: boolean
  onActivateChoice: (choice: LauncherResultChoice) => void
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const secondary = choice.secondaryActions ?? []

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      className={`l-suggest-row ${selected ? 'sel' : ''}`}
    >
      <button
        type="button"
        tabIndex={-1}
        className="l-suggest-row-main"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onActivateChoice(choice)}
      >
        <span className="r-ico r-favicon" aria-hidden>
          {resolveIcon(
            choice.icon ?? fallbackIcon,
            18,
            choice.title,
          )}
        </span>
        <div className="r-main">
          <span className="r-title">{choice.title}</span>
          {choice.subtitle ? (
            <span className="r-desc" title={choice.subtitle}>{choice.subtitle}</span>
          ) : null}
        </div>
        {selected ? <span className="r-kbd">↵</span> : null}
      </button>
      {onSecondaryAction && secondary.map((action) => (
        <Tooltip key={action.id} label={action.title}>
          <button
            type="button"
            tabIndex={-1}
            className="l-suggest-row-secondary"
            disabled={disabled}
            aria-label={action.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSecondaryAction(choice, action.id)
            }}
          >
            {action.icon ? resolveIcon(action.icon, 14) : '×'}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

export type { OutputDestinationId } from './LauncherOutputTargets'

/** Extract single-text live preview from pure-function preview output. */
export function extractLivePreviewText(output?: LauncherOutput): string | null {
  if (!output?.choices?.length) return null
  // Suggest lists are multi-row navigation, not a preview well.
  if (output.choices.length !== 1) return null
  const choice = output.choices[0]
  const text = (choice.preview ?? choice.title ?? '').trim()
  return text || null
}

export function GlobalLauncherCollectInputFrame({
  isImeComposingRef,
  inputRef,
  bindSearchInputRef,
  frame,
  busy,
  deliveryIntent,
  error,
  locale,
  paramChips,
  onInputChange,
  onBack,
  onExitCommand,
  onActivateChoice,
  onSecondaryAction,
  onPastePreviewText,
  onSubmitPrimary,
  onCaptureSelection,
}: {
  isImeComposingRef: RefObject<boolean>
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  bindSearchInputRef?: (node: HTMLInputElement | HTMLTextAreaElement | null) => void
  frame: CollectInputFrame
  busy: boolean
  deliveryIntent?: LauncherControllerState['deliveryIntent']
  error?: string | null
  locale: Locale
  paramChips: { label: string; value: string }[]
  onInputChange: (value: string) => void
  /** Empty ⌫ / Esc: stack-style (re-enter last param, then leave command). */
  onBack: () => void
  /** Command-tag ×: exit whole command to search. */
  onExitCommand?: () => void
  onActivateChoice: (choice: LauncherResultChoice) => void
  /** Host wiring: run a secondary action by id (plugin defines the action ids). */
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  /** Paste live-preview text into the frontmost app (package 4 destination). */
  onPastePreviewText?: (choice: LauncherResultChoice) => void | Promise<void>
  /** Enter when no destination chrome — default submit path. */
  onSubmitPrimary?: () => void
  onCaptureSelection?: () => void
}) {
  const placeholder = frame.input.placeholderI18n?.[locale] ?? frame.input.placeholder ?? ''
  const explicitPreview = frame.item.executionMode === 'explicit-text-preview'
  const materialTextEdit = frame.item.materialTextEdit === true
  const multilineInput = materialTextEdit || explicitPreview
  const previewChoices = frame.previewOutput?.choices ?? []
  const selectedIndex = frame.selectedSuggestionIndex ?? -1
  const hasSuggestions = previewChoices.length > 0
  const isSuggestMode = Boolean(frame.item.suggest)
  const livePreviewText = !isSuggestMode ? extractLivePreviewText(frame.previewOutput) : null
  const showLivePreview = !isSuggestMode && !explicitPreview && !frame.item.metadataInput && !materialTextEdit
  const filterText = frame.inputText.trim()
  // Local latch: never blank the well while typing — only replace when a new text arrives.
  const lastPreviewRef = useRef<string | null>(null)
  if (!filterText) {
    lastPreviewRef.current = null
  } else if (livePreviewText) {
    lastPreviewRef.current = livePreviewText
  }
  const displayPreviewText = filterText ? (livePreviewText ?? lastPreviewRef.current) : null
  // Preview is fresh only when it was computed for the current inputText.
  const previewFresh = Boolean(
    livePreviewText
    && frame.previewInputText !== undefined
    && frame.previewInputText === frame.inputText,
  )
  // Empty well only when input is empty.
  const showLiveEmpty = showLivePreview && !filterText
  // Suggest-backed collect-input: empty choices after load = true empty state (not a fake row).
  const showEmptyState = isSuggestMode && !busy && !hasSuggestions && frame.previewInputText !== undefined
  const commandTitle = resolveDisplayTitle(frame.item.display, locale)
  const previewChoice = livePreviewText ? previewChoices[0] : undefined
  const hasReturn = Boolean(previewChoice?.secondaryActions?.some((a) => a.id === 'return-to-launcher'))
  const hasPaste = !explicitPreview && !frame.item.metadataInput && !materialTextEdit && Boolean(onPastePreviewText)
  const {
    destinations,
    activeDest,
    cycle,
    selectId,
    resolveFromKeyboard,
  } = useOutputDestinations({
    hasPaste,
    hasReturn,
    hasCopy: !previewChoice || getHostOutputIntent(previewChoice) === 'copy',
    hasPrimary: Boolean(previewChoice && getHostOutputIntent(previewChoice) !== 'copy'),
    // Do not reset destination index on every preview text change (avoids bar remount thrash).
    resetKey: frame.item.systemKey,
  })

  const runDestination = async (destId: OutputDestinationId) => {
    if (busy) return
    if (destId === 'paste-foreground') {
      // Preserve the explicit paste intent; a stale preview must neither paste
      // old text nor fall through to the primary action (commonly Copy).
      if (!previewChoice || !livePreviewText || !previewFresh) {
        showToast(t(locale, 'palette.outputPastePreviewPending'), 'info')
        return
      }
      await onPastePreviewText?.(previewChoice)
      return
    }
    // No fresh preview for current input → full submit (fresh execute).
    if (!previewChoice || !livePreviewText || !previewFresh) {
      onSubmitPrimary?.()
      return
    }
    if (destId === 'copy' || destId === 'primary') {
      await onActivateChoice(previewChoice)
      return
    }
    if (destId === 'return-to-launcher') {
      onSecondaryAction?.(previewChoice, 'return-to-launcher')
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
    if (multilineInput) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        if (!busy) onSubmitPrimary?.()
      }
      return
    }
    if (event.key === 'Backspace' && !frame.inputText) {
      event.preventDefault()
      event.stopPropagation()
      onBack()
      return
    }
    if (showLivePreview && displayPreviewText && event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      cycle(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Enter') {
      // Suggest mode: panel keyboard owns ↑↓/Enter via controller.
      if (isSuggestMode) return
      event.preventDefault()
      event.stopPropagation()
      if (busy) return
      if (explicitPreview || frame.item.metadataInput) {
        if (!event.shiftKey && !event.altKey) onSubmitPrimary?.()
        return
      }
      void runDestination(resolveFromKeyboard(event))
    }
  }

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <LauncherCommandTag
          title={commandTitle}
          icon={frame.item.display.icon}
          locale={locale}
          onRemove={onExitCommand ?? onBack}
        />
        <LauncherParamChipTrail chips={paramChips} />
        {!multilineInput && <input
          ref={bindSearchInputRef ?? (inputRef as RefObject<HTMLInputElement | null>)}
          value={frame.inputText}
          autoFocus
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className="mono"
          style={{ caretColor: 'var(--text, currentColor)' }}
        />}
        {busy && (
          <span className="meta anim-running-pulse" role="status" aria-live="polite">{t(locale, deliveryIntent === 'copy' ? 'palette.outputCopying' : deliveryIntent ? 'palette.outputDelivering' : 'palette.outputRunning')}</span>
        )}
      </div>
      {multilineInput && (
        <div className="global-launcher-body launcher-material-text-edit" data-no-drag>
          <textarea
            ref={bindSearchInputRef ?? (inputRef as RefObject<HTMLTextAreaElement | null>)}
            value={frame.inputText.replace(/\r\n|\r/g, '\n')}
            autoFocus
            rows={8}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            aria-label={commandTitle}
            placeholder={placeholder}
            data-launcher-scrollable
            onChange={(event) => onInputChange(reconcileMaterialTextInput(frame.inputText, event.target.value))}
            onKeyDown={handleInputKeyDown}
            onWheel={(event) => event.stopPropagation()}
          />
        </div>
      )}
      {error && (
        <div role="alert" className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      {showLivePreview && (
        <>
          {showLiveEmpty ? (
            <LauncherEmptyWell
              testId="launcher-preview-well"
              title={t(locale, 'palette.livePreviewEmpty')}
            />
          ) : (
            // Always keep the well mounted while typing so window height does not thrash.
            // Text only replaces when a new preview arrives (lastPreviewRef latch).
            <div
              className="launcher-preview-well"
              data-testid="launcher-preview-well"
              data-no-drag
              data-launcher-scrollable
              data-stale={displayPreviewText && !previewFresh ? 'true' : undefined}
              aria-live="polite"
              onMouseDown={(event) => {
                // Keep focus/selection inside the well; don't let panel drag steal the gesture.
                event.stopPropagation()
              }}
              onWheel={(event) => {
                event.stopPropagation()
              }}
            >
              {displayPreviewText ? (
                <pre
                  tabIndex={0}
                  aria-label={t(locale, 'palette.preview')}
                  onKeyDown={(event) => {
                    // ⌘/Ctrl+A selects only the preview text (not the whole launcher).
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
                  <span className="launcher-preview-text">{displayPreviewText}</span>
                </pre>
              ) : null}
            </div>
          )}
          {displayPreviewText && destinations.length > 0 && (
            <LauncherOutputTargetsBar
              destinations={destinations}
              disabled={busy}
              activeId={activeDest?.id ?? 'copy'}
              locale={locale}
              onSelect={(id) => {
                selectId(id)
                void runDestination(id)
              }}
            />
          )}
        </>
      )}
      {isSuggestMode && hasSuggestions && (
        <div className="global-launcher-body l-results l-suggest-list">
          {previewChoices.map((choice, index) => (
            <CollectInputSuggestRow
              key={choice.id}
              choice={choice}
              selected={index === selectedIndex}
              fallbackIcon={frame.item.display.icon}
              disabled={busy}
              onActivateChoice={onActivateChoice}
              onSecondaryAction={onSecondaryAction}
            />
          ))}
        </div>
      )}
      {showEmptyState && (
        <LauncherEmptyWell
          title={t(locale, filterText ? 'palette.collectInputEmptyTitle' : 'palette.collectInputSuggestEmptyTitle')}
          icon={filterText ? <CornerDownLeft size={24} strokeWidth={1.75} /> : <History size={24} strokeWidth={1.75} />}
          hint={
            filterText
              ? t(locale, 'palette.collectInputEmptyFilterHint', { query: filterText })
              : t(locale, 'palette.collectInputSuggestEmptyHint')
          }
          action={(
            <button
              type="button"
              className="launcher-empty-well-back"
              data-testid="launcher-collect-empty-back"
              data-no-drag
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onBack()}
            >
              {t(locale, 'palette.back')}
              <kbd>esc</kbd>
            </button>
          )}
        />
      )}
      <div className="global-launcher-footer l-foot">
        {!explicitPreview && !frame.item.metadataInput && onCaptureSelection && !frame.inputText && frame.item.behavior.type === 'perform' && frame.item.inputPolicy && frame.item.inputPolicy.mode !== 'all' && (
          <button
            type="button"
            className="launcher-footer-back-btn"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
            }}
            onClick={onCaptureSelection}
          >
            {t(locale, 'palette.captureSelection')}
          </button>
        )}
        {multilineInput ? (
          <>
            <LauncherHintKey keys="↵" label={t(locale, 'palette.objectBlockEditNewline')} />
            <button
              type="button"
              className="launcher-footer-back-btn"
              disabled={busy}
              data-no-drag
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) event.preventDefault()
                if (event.key !== 'Escape') event.stopPropagation()
              }}
              onClick={() => { if (!busy) onSubmitPrimary?.() }}
            >
              <LauncherHintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, materialTextEdit ? 'palette.objectBlockEditConfirm' : 'palette.preview')} />
            </button>
          </>
        ) : showLivePreview && displayPreviewText && !showLiveEmpty ? (
          <LauncherOutputTargetsFooter destinations={destinations} locale={locale} />
        ) : isSuggestMode && hasSuggestions ? (
          <LauncherHintText label={t(locale, 'palette.collectInputSuggestHint')} />
        ) : showEmptyState && filterText ? (
          <LauncherHintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />
        ) : showEmptyState ? (
          <LauncherHintText label={t(locale, 'palette.collectInputEmptyFooter')} />
        ) : (
          <LauncherHintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />
        )}
        <button
          type="button"
          className="launcher-footer-back-btn"
          data-testid="launcher-collect-footer-back"
          data-no-drag
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (!multilineInput) return
            if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) event.preventDefault()
            if (event.key !== 'Escape') event.stopPropagation()
          }}
          onClick={() => onBack()}
          aria-label={t(locale, materialTextEdit ? 'palette.objectBlockEditCancel' : 'palette.back')}
        >
          <LauncherHintKey keys="esc" label={t(locale, materialTextEdit ? 'palette.objectBlockEditCancel' : 'palette.back')} />
        </button>
      </div>
    </>
  )
}
