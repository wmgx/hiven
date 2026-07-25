import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherResultChoiceRow } from './LauncherResultChoiceRow'
import { LauncherCommandTag } from './LauncherCommandTag'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'
import type { OutputDestinationId } from './GlobalLauncherCollectInputFrame'

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
  const metaLabel = getPlatformShortcutMeta().label
  const hasReturn = Boolean(textChoice?.secondaryActions?.some((a) => a.id === 'return-to-launcher'))
  const destinations = useMemo(() => {
    if (!singleText) return [] as Array<{ id: OutputDestinationId; keys: string; labelKey: string }>
    const list: Array<{ id: OutputDestinationId; keys: string; labelKey: string }> = [
      { id: 'copy', keys: '↵', labelKey: 'outputCopy' },
    ]
    if (onPastePreviewText) {
      list.push({ id: 'paste-foreground', keys: '⇧↵', labelKey: 'outputPasteForeground' })
    }
    if (hasReturn) {
      list.push({ id: 'return-to-launcher', keys: `${metaLabel}↵`, labelKey: 'returnToLauncher' })
    }
    return list
  }, [singleText, onPastePreviewText, hasReturn, metaLabel])
  const [destIndex, setDestIndex] = useState(0)
  const activeDest = destinations[Math.min(destIndex, Math.max(0, destinations.length - 1))] ?? destinations[0]

  useEffect(() => {
    setDestIndex(0)
  }, [frame.sourceTitle, previewText])

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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!singleText || !textChoice) return
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      if (destinations.length < 2) return
      setDestIndex((index) => (index + (event.shiftKey ? -1 : 1) + destinations.length) % destinations.length)
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    if (event.metaKey || event.ctrlKey) {
      void runDestination(destinations.find((d) => d.id === 'return-to-launcher')?.id ?? 'copy')
      return
    }
    if (event.shiftKey) {
      void runDestination(destinations.find((d) => d.id === 'paste-foreground')?.id ?? 'copy')
      return
    }
    void runDestination((activeDest?.id as OutputDestinationId) ?? 'copy')
  }

  if (singleText && textChoice) {
    return (
      <div className="launcher-result-text-frame" onKeyDown={handleKeyDown} tabIndex={-1}>
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
          aria-live="polite"
        >
          <pre>{previewText}</pre>
        </div>
        {destinations.length > 0 && (
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
        {error && (
          <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
            {error}
          </div>
        )}
        <div className="global-launcher-footer l-foot">
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
