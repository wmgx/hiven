import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { CollectInputFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { IconRef, LauncherOutput, LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'
import { Tooltip } from '../Tooltip'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherCommandTag, LauncherParamValueChip } from './LauncherCommandTag'
import { LauncherEmptyWell } from './LauncherEmptyWell'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'

/** Suggest row: keep keyboard highlight in view (same as result / mixed list). */
function CollectInputSuggestRow({
  choice,
  selected,
  fallbackIcon,
  onActivateChoice,
  onSecondaryAction,
}: {
  choice: LauncherResultChoice
  selected: boolean
  fallbackIcon?: IconRef
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

export type OutputDestinationId = 'copy' | 'paste-foreground' | 'return-to-launcher'

type OutputDestination = {
  id: OutputDestinationId
  keys: string
  labelKey: 'outputCopy' | 'outputPasteForeground' | 'returnToLauncher'
}

/** Extract single-text live preview from pure-function preview output. */
export function extractLivePreviewText(output?: LauncherOutput): string | null {
  if (!output?.choices?.length) return null
  // Suggest lists are multi-row navigation, not a preview well.
  if (output.choices.length !== 1) return null
  const choice = output.choices[0]
  const text = (choice.preview ?? choice.title ?? '').trim()
  return text || null
}

function buildDestinations(params: {
  hasPaste: boolean
  hasReturn: boolean
  metaLabel: string
}): OutputDestination[] {
  // Package 4 keys (2026-07-26 handoff): ↵ copy · ⇧↵ paste front · ⌘/Ctrl↵ return to launcher
  const list: OutputDestination[] = [
    { id: 'copy', keys: '↵', labelKey: 'outputCopy' },
  ]
  if (params.hasPaste) {
    list.push({ id: 'paste-foreground', keys: '⇧↵', labelKey: 'outputPasteForeground' })
  }
  if (params.hasReturn) {
    list.push({ id: 'return-to-launcher', keys: `${params.metaLabel}↵`, labelKey: 'returnToLauncher' })
  }
  return list
}

export function GlobalLauncherCollectInputFrame({
  inputRef,
  bindSearchInputRef,
  frame,
  busy,
  error,
  locale,
  paramChips,
  onInputChange,
  onBack,
  onActivateChoice,
  onSecondaryAction,
  onPastePreviewText,
  onSubmitPrimary,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  bindSearchInputRef?: (node: HTMLInputElement | null) => void
  frame: CollectInputFrame
  busy: boolean
  error?: string | null
  locale: Locale
  paramChips: { label: string; value: string }[]
  onInputChange: (value: string) => void
  onBack: () => void
  onActivateChoice: (choice: LauncherResultChoice) => void
  /** Host wiring: run a secondary action by id (plugin defines the action ids). */
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  /** Paste live-preview text into the frontmost app (package 4 destination). */
  onPastePreviewText?: (text: string) => void | Promise<void>
  /** Enter when no destination chrome — default submit path. */
  onSubmitPrimary?: () => void
}) {
  const placeholder = frame.input.placeholder ?? ''
  const previewChoices = frame.previewOutput?.choices ?? []
  const selectedIndex = frame.selectedSuggestionIndex ?? -1
  const hasSuggestions = previewChoices.length > 0
  const isSuggestMode = Boolean(frame.item.suggest)
  const livePreviewText = !isSuggestMode ? extractLivePreviewText(frame.previewOutput) : null
  const showLivePreview = !isSuggestMode
  const filterText = frame.inputText.trim()
  // Suggest-backed collect-input: empty choices after load = true empty state (not a fake row).
  const showEmptyState = isSuggestMode && !busy && !hasSuggestions && frame.previewInputText !== undefined
  const commandTitle = resolveDisplayTitle(frame.item.display, locale)
  const metaLabel = getPlatformShortcutMeta().label
  const previewChoice = livePreviewText ? previewChoices[0] : undefined
  const hasReturn = Boolean(previewChoice?.secondaryActions?.some((a) => a.id === 'return-to-launcher'))
  const destinations = useMemo(
    () => buildDestinations({
      hasPaste: Boolean(onPastePreviewText),
      hasReturn,
      metaLabel,
    }),
    [onPastePreviewText, hasReturn, metaLabel],
  )
  const [destIndex, setDestIndex] = useState(0)
  const activeDest = destinations[Math.min(destIndex, Math.max(0, destinations.length - 1))] ?? destinations[0]

  useEffect(() => {
    setDestIndex(0)
  }, [frame.item.systemKey, livePreviewText])

  const cycleDestination = (delta: number) => {
    if (destinations.length < 2) return
    setDestIndex((index) => (index + delta + destinations.length) % destinations.length)
  }

  const runDestination = async (destId: OutputDestinationId) => {
    if (!previewChoice || !livePreviewText) {
      onSubmitPrimary?.()
      return
    }
    if (destId === 'copy') {
      await onActivateChoice(previewChoice)
      return
    }
    if (destId === 'paste-foreground') {
      await onPastePreviewText?.(livePreviewText)
      return
    }
    if (destId === 'return-to-launcher') {
      onSecondaryAction?.(previewChoice, 'return-to-launcher')
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !frame.inputText) {
      event.preventDefault()
      event.stopPropagation()
      onBack()
      return
    }
    if (showLivePreview && livePreviewText && event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      cycleDestination(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Enter') {
      // Suggest mode: panel keyboard owns ↑↓/Enter via controller.
      if (isSuggestMode) return
      event.preventDefault()
      event.stopPropagation()
      // ⌘/Ctrl↵ → return to launcher; ⇧↵ → paste to front; bare ↵ → active destination (default copy)
      if (event.metaKey || event.ctrlKey) {
        const ret = destinations.find((d) => d.id === 'return-to-launcher')
        void runDestination(ret?.id ?? 'copy')
        return
      }
      if (event.shiftKey) {
        const paste = destinations.find((d) => d.id === 'paste-foreground')
        void runDestination(paste?.id ?? 'copy')
        return
      }
      void runDestination(activeDest?.id ?? 'copy')
    }
  }

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <LauncherCommandTag
          title={commandTitle}
          icon={frame.item.display.icon}
          locale={locale}
          onRemove={onBack}
        />
        {paramChips.map((chip) => (
          <LauncherParamValueChip key={chip.label} label={chip.label} value={chip.value} />
        ))}
        <input
          ref={bindSearchInputRef ?? inputRef}
          value={frame.inputText}
          autoFocus
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className="mono"
          style={{ caretColor: 'var(--text, currentColor)' }}
        />
        {busy && (
          <span className="meta anim-running-pulse" aria-live="polite">...</span>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      {showLivePreview && (
        <>
          {livePreviewText ? (
            <div
              className={`launcher-preview-well${busy ? ' is-stale' : ''}`}
              data-testid="launcher-preview-well"
              aria-live="polite"
            >
              <pre>{livePreviewText}</pre>
            </div>
          ) : (
            <LauncherEmptyWell
              testId="launcher-preview-well"
              title={busy ? t(locale, 'palette.livePreviewStale') : t(locale, 'palette.livePreviewEmpty')}
            />
          )}
          {livePreviewText && destinations.length > 0 && (
            <div
              className="launcher-output-targets"
              data-testid="launcher-output-targets"
              role="listbox"
              aria-label={t(locale, 'palette.outputSwitchTarget')}
            >
              {destinations.map((dest) => (
                <button
                  key={dest.id}
                  type="button"
                  role="option"
                  aria-selected={activeDest?.id === dest.id}
                  className={`launcher-output-target${activeDest?.id === dest.id ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setDestIndex(destinations.findIndex((d) => d.id === dest.id))
                    void runDestination(dest.id)
                  }}
                >
                  {dest.keys ? <kbd>{dest.keys}</kbd> : null}
                  <span>{t(locale, `palette.${dest.labelKey}`)}</span>
                </button>
              ))}
            </div>
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
              onActivateChoice={onActivateChoice}
              onSecondaryAction={onSecondaryAction}
            />
          ))}
        </div>
      )}
      {showEmptyState && (
        <LauncherEmptyWell
          title={t(locale, 'palette.collectInputEmptyTitle')}
          hint={
            filterText
              ? t(locale, 'palette.collectInputEmptyFilterHint', { query: filterText })
              : t(locale, 'palette.collectInputEmptyHint')
          }
        />
      )}
      <div className="global-launcher-footer l-foot">
        {showLivePreview && livePreviewText ? (
          <>
            <LauncherHintKey keys="↵" label={t(locale, 'palette.outputCopy')} />
            {onPastePreviewText ? (
              <LauncherHintKey keys="⇧↵" label={t(locale, 'palette.outputPasteForeground')} />
            ) : null}
            {hasReturn ? (
              <LauncherHintKey keys={`${metaLabel}↵`} label={t(locale, 'palette.returnToLauncher')} />
            ) : null}
            {destinations.length > 1 ? (
              <LauncherHintKey keys="⇥" label={t(locale, 'palette.outputSwitchTarget')} />
            ) : null}
          </>
        ) : isSuggestMode && hasSuggestions ? (
          <LauncherHintText label={t(locale, 'palette.collectInputSuggestHint')} />
        ) : showEmptyState ? (
          <LauncherHintText label={t(locale, 'palette.collectInputEmptyFooter')} />
        ) : (
          <LauncherHintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />
        )}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
