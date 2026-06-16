import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useAppStore } from '../store'
import { translate } from '../i18n'

export type ShortcutRecorderValue =
  | { kind: 'accelerator'; accelerator: string }
  | { kind: 'disabled' }

type ShortcutRecorderProps = {
  value: ShortcutRecorderValue
  emptyLabel?: string
  status?: ReactNode
  hint?: ReactNode
  onRecord: (value: Exclude<ShortcutRecorderValue, { kind: 'disabled' }>) => void
  onClear?: () => void
  clearLabel?: string
}

type HotkeyPlatformLabels = {
  isMac: boolean
  command: string
  option: string
}

export function ShortcutRecorder({
  value,
  emptyLabel,
  status,
  hint,
  onRecord,
  onClear,
  clearLabel,
}: ShortcutRecorderProps) {
  const locale = useAppStore((s) => s.locale)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef<HTMLButtonElement>(null)
  const platformLabels = useMemo(() => getHotkeyPlatformLabels(), [])
  const recordLabel = translate(locale, 'settings', 'hotkeyRecord')
  const recordingLabel = translate(locale, 'settings', 'hotkeyRecording')
  const recordError = translate(locale, 'settings', 'hotkeyRecordError')
  const disabledLabel = translate(locale, 'settings', 'hotkeyDisabled')

  const displayValue = isRecording
    ? recordingLabel
    : formatShortcutRecorderValueLabel(value, locale, platformLabels, emptyLabel ?? disabledLabel)

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isRecording) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setError('')
      setIsRecording(false)
      return
    }

    const recorded = eventToAccelerator(event)
    if (!recorded) {
      setError(isModifierKey(event.key) ? '' : recordError)
      return
    }
    setError('')
    setIsRecording(false)
    onRecord(recorded)
  }

  useEffect(() => {
    if (!isRecording) return
    ;(window as unknown as { __FLUXTEXT_HOTKEY_RECORDING__?: boolean }).__FLUXTEXT_HOTKEY_RECORDING__ = true
    const timer = window.setTimeout(() => {
      setIsRecording(false)
      setError('')
    }, 10_000)
    return () => {
      window.clearTimeout(timer)
      ;(window as unknown as { __FLUXTEXT_HOTKEY_RECORDING__?: boolean }).__FLUXTEXT_HOTKEY_RECORDING__ = false
    }
  }, [isRecording])

  const startRecording = () => {
    setError('')
    setIsRecording(true)
    requestAnimationFrame(() => recorderRef.current?.focus())
  }

  return (
    <div className="shortcut-recorder">
      <button
        ref={recorderRef}
        type="button"
        className={`shortcut-recorder-display ${isRecording ? 'is-recording' : ''}`}
        onClick={startRecording}
        onKeyDown={handleKeyDown}
      >
        {displayValue}
      </button>
      <div className="shortcut-recorder-actions">
        <button type="button" className="scripts-btn" onClick={startRecording}>{recordLabel}</button>
        {onClear && (
          <button
            type="button"
            className="scripts-btn"
            onClick={() => {
              setError('')
              setIsRecording(false)
              onClear()
            }}
          >
            {clearLabel ?? disabledLabel}
          </button>
        )}
      </div>
      {(error || status) && (
        <span className={`shortcut-recorder-status ${error ? 'is-error' : ''}`}>
          {error || status}
        </span>
      )}
      {hint && <span className="shortcut-recorder-hint">{hint}</span>}
    </div>
  )
}

export function getHotkeyPlatformLabels(): HotkeyPlatformLabels {
  const isMac = isMacPlatform()
  return {
    isMac,
    command: isMac ? 'Cmd' : 'Ctrl',
    option: isMac ? 'Option' : 'Alt',
  }
}

export function formatShortcutRecorderValueLabel(
  value: ShortcutRecorderValue,
  locale: 'zh' | 'en',
  platformLabels = getHotkeyPlatformLabels(),
  disabledLabel = translate(locale, 'settings', 'hotkeyDisabled'),
): string {
  if (value.kind === 'accelerator') return formatAcceleratorLabel(value.accelerator, platformLabels)
  return disabledLabel
}

function eventToAccelerator(event: KeyboardEvent<HTMLElement>): Exclude<ShortcutRecorderValue, { kind: 'disabled' }> | null {
  const key = normalizeKey(event.key)
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
  if (!key || !hasModifier) return null

  const parts: string[] = []
  if (event.metaKey) parts.push('Cmd')
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return { kind: 'accelerator', accelerator: parts.join('+') }
}

function normalizeKey(key: string): string | null {
  if (isModifierKey(key)) return null
  if (key === ' ' || key === 'Space') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  if (key.startsWith('Arrow')) return key.replace('Arrow', '')
  return key
}

function isModifierKey(key: string): boolean {
  return key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift'
}

function isMacPlatform(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const platform = nav?.platform || ''
  const userAgent = nav?.userAgent || ''
  const userAgentDataPlatform = (nav as Navigator & { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform || ''
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${userAgentDataPlatform} ${userAgent}`)
}

function formatAcceleratorLabel(accelerator: string, platformLabels: HotkeyPlatformLabels): string {
  if (platformLabels.isMac) return accelerator
  return accelerator.replace(/\bCmd\b/g, platformLabels.command).replace(/\bOption\b/g, platformLabels.option)
}
