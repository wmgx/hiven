import { type RefObject } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { CollectInputFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'

export function GlobalLauncherCollectInputFrame({
  inputRef,
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
          ref={inputRef}
          value={frame.inputText}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={placeholder}
          className="mono"
        />
        {busy && (
          <span className="meta">...</span>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      {hasSuggestions && (
        <div className="global-launcher-body l-results l-suggest-list">
          {previewChoices.map((choice, index) => {
            const selected = index === selectedIndex
            const secondary = choice.secondaryActions ?? []
            return (
              <div
                key={choice.id}
                className={`l-suggest-row ${selected ? 'sel' : ''}`}
              >
                <button
                  type="button"
                  className="l-suggest-row-main"
                  onClick={() => onActivateChoice(choice)}
                >
                  <span className="r-ico r-favicon" aria-hidden>
                    {resolveIcon(
                      choice.icon ?? frame.item.display.icon,
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
                  <button
                    key={action.id}
                    type="button"
                    className="l-suggest-row-secondary"
                    title={action.title}
                    aria-label={action.title}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onSecondaryAction(choice, action.id)
                    }}
                  >
                    ×
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <div className="global-launcher-footer l-foot">
        {hasSuggestions
          ? <LauncherHintText label={t(locale, 'palette.collectInputSuggestHint')} />
          : <LauncherHintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
