import { useEffect, useRef, type RefObject } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { CollectInputFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { IconRef, LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'
import { Tooltip } from '../Tooltip'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'

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
}) {
  const placeholder = frame.input.placeholder ?? ''
  const previewChoices = frame.previewOutput?.choices ?? []
  const selectedIndex = frame.selectedSuggestionIndex ?? -1
  const hasSuggestions = previewChoices.length > 0
  const filterText = frame.inputText.trim()
  // Suggest-backed collect-input: empty choices after load = true empty state (not a fake row).
  const showEmptyState = Boolean(frame.item.suggest) && !busy && !hasSuggestions && frame.previewInputText !== undefined

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <button className="back" type="button" onClick={onBack}>‹</button>
        <span className="title">
          <span className="t-ico">{resolveIcon(frame.item.display.icon, 14, resolveDisplayTitle(frame.item.display, locale))}</span>
          {resolveDisplayTitle(frame.item.display, locale)}
        </span>
        {paramChips.map((chip) => (
          <span
            key={chip.label}
            className="kbd shrink-0 max-w-[100px] truncate"
            title={`${chip.label}: ${chip.value}`}
          >
            {chip.value}
          </span>
        ))}
        <span className="vbar" />
        <input
          ref={bindSearchInputRef ?? inputRef}
          value={frame.inputText}
          autoFocus
          onChange={(event) => onInputChange(event.target.value)}
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
      {hasSuggestions && (
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
        <div
          className="global-launcher-body l-results"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '28px 20px',
            textAlign: 'center',
            minHeight: 96,
          }}
          role="status"
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary, var(--muted-foreground, #888))' }}>
            {t(locale, 'palette.collectInputEmptyTitle')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary, var(--muted-foreground, #999))', maxWidth: 320 }}>
            {filterText
              ? t(locale, 'palette.collectInputEmptyFilterHint').replace('{query}', filterText)
              : t(locale, 'palette.collectInputEmptyHint')}
          </div>
        </div>
      )}
      <div className="global-launcher-footer l-foot">
        {hasSuggestions
          ? <LauncherHintText label={t(locale, 'palette.collectInputSuggestHint')} />
          : showEmptyState
            ? <LauncherHintText label={t(locale, 'palette.collectInputEmptyFooter')} />
            : <LauncherHintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
