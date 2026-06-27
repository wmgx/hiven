import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import type { ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { HintKey, LauncherFooter } from './LauncherFooter'

type ResultStepProps = {
  frame: ResultFrame
  error: string | null
  busy: boolean
  onActivateChoice: (choice: LauncherResultChoice) => void
  onActivateSecondary: (choice: LauncherResultChoice, actionId: string) => void
  onSubmitSelection: (choices: LauncherResultChoice[]) => void
  onBack: () => void
  locale: Locale
}

export function ResultStep(props: ResultStepProps) {
  return <ResultStepBody key={getResultFrameKey(props.frame)} {...props} />
}

function getResultFrameKey(frame: ResultFrame) {
  const choices = frame.output.choices ?? []
  const selectionType = frame.output.selection?.type ?? 'single'
  return `${frame.sourceTitle ?? ''}:${selectionType}:${choices.map((choice) => choice.id).join('|')}`
}

function ResultStepBody({ frame, error, busy, onActivateChoice, onActivateSecondary, onSubmitSelection, onBack, locale }: ResultStepProps) {
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState(0)
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([])
  const choices = useMemo(() => frame.output.choices ?? [], [frame])
  const selection = frame.output.selection?.type === 'multi' ? frame.output.selection : null
  const selectedChoices = choices.filter((choice) => selectedChoiceIds.includes(choice.id))
  const canSubmitSelection = selection
    ? selectedChoices.length >= selection.min && selectedChoices.length <= selection.max
    : false

  const toggleChoice = useCallback((choice: LauncherResultChoice) => {
    if (!selection || busy) return
    setSelectedChoiceIds((current) => {
      if (current.includes(choice.id)) return current.filter((id) => id !== choice.id)
      if (current.length >= selection.max) return current
      return [...current, choice.id]
    })
  }, [busy, selection])

  const submitSelection = useCallback(() => {
    if (!selection || !canSubmitSelection || busy) return
    onSubmitSelection(selectedChoices)
  }, [busy, canSubmitSelection, onSubmitSelection, selectedChoices, selection])

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedChoiceIndex((index) => Math.min(index + 1, choices.length - 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedChoiceIndex((index) => Math.max(index - 1, 0))
      }
      if (selection && event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        const choice = choices[selectedChoiceIndex]
        if (choice) toggleChoice(choice)
      }
      if (event.key === 'Enter' && !busy) {
        event.preventDefault()
        event.stopPropagation()
        if (selection) {
          submitSelection()
          return
        }
        const choice = choices[selectedChoiceIndex]
        if (choice) onActivateChoice(choice)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onBack()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [busy, choices, onActivateChoice, onBack, selectedChoiceIndex, selection, submitSelection, toggleChoice])

  return (
    <>
      <div className="flex items-center px-3.5 gap-2 h-[44px]" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <button className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        {frame.sourceTitle && (
          <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{frame.sourceTitle}</span>
        )}
      </div>
      <div className="command-palette-results global-launcher-body l-list">
        {choices.map((choice, index) => {
          const isSelected = selectedChoiceIndex === index
          const isChecked = selectedChoiceIds.includes(choice.id)
          return (
            <div
              key={choice.id}
              className={`l-row global-launcher-result-row ${isSelected ? 'sel selected' : ''}`}
              onClick={() => selection ? toggleChoice(choice) : onActivateChoice(choice)}
              onMouseEnter={() => setSelectedChoiceIndex(index)}
            >
              {selection && (
                <div
                  className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: isChecked ? 'var(--color-accent)' : 'var(--color-background-tertiary)',
                    color: isChecked ? 'white' : 'var(--color-text-tertiary)',
                  }}
                >
                  {isChecked && <Check size={13} />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: isSelected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {choice.title}
                </div>
                {choice.subtitle && (
                  <div className="text-[11px]" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
                    {choice.subtitle}
                  </div>
                )}
              </div>
              {choice.secondaryActions && choice.secondaryActions.length > 0 && (
                <div className="flex gap-1 shrink-0">
                  {choice.secondaryActions.map((action) => (
                    <button
                      key={action.id}
                      className="text-[10px] px-1.5 py-0.5 rounded border-none cursor-pointer"
                      style={{
                        background: 'var(--color-background-secondary)',
                        border: '0.5px solid var(--color-border-tertiary)',
                        color: isSelected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)',
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onActivateSecondary(choice, action.id)
                      }}
                    >
                      {action.title}
                    </button>
                  ))}
                </div>
              )}
              {isSelected && !selection && (
                <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}>↵</kbd>
              )}
            </div>
          )
        })}
        {choices.length === 0 && (
          <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.noResults')}</div>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[11px]" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}
      <LauncherFooter>
        <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        {selection && <HintKey keys="space" label={t(locale, 'palette.toggle')} />}
        <HintKey keys="↵" label={selection?.submitTitle ?? t(locale, 'palette.select')} />
        {selection && (
          <span className="text-[11px]" style={{ color: canSubmitSelection ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}>
            {selectedChoices.length}/{selection.max}
          </span>
        )}
        <HintKey keys="esc" label={t(locale, 'palette.back')} />
      </LauncherFooter>
    </>
  )
}
