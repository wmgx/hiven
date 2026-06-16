import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { GlobalPinnedLauncherDoubleModifier } from '../store'
import { useAppStore } from '../store'
import { translate } from '../i18n'

export type ShortcutRecorderValue =
  | { kind: 'accelerator'; accelerator: string }
  | { kind: 'double-modifier'; modifier: GlobalPinnedLauncherDoubleModifier }
  | { kind: 'disabled' }

type LastModifierTap = { modifier: GlobalPinnedLauncherDoubleModifier; time: number }

type ShortcutRecorderProps = {
  value: ShortcutRecorderValue
  allowDoubleModifier?: boolean
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
  allowDoubleModifier = false,
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
  const lastModifierTapRef = useRef<LastModifierTap | null>(null)
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

    if (event.key === 'Delete' || event.key === 'Backspace') {
      setError('')
      setIsRecording(false)
      if (onClear) onClear()
      return
    }

    const recordedShortcut = eventToShortcutRecorderValue(event, lastModifierTapRef.current, allowDoubleModifier)
    lastModifierTapRef.current = recordedShortcut.lastModifierTap
    if (!recordedShortcut.shortcut) {
      setError(isModifierKey(event.key) ? '' : recordError)
      return
    }
    setError('')
    setIsRecording(false)
    onRecord(recordedShortcut.shortcut)
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
    lastModifierTapRef.current = null
    setIsRecording(true)
    requestAnimationFrame(() => recorderRef.current?.focus())
  }

  const handleBlur = () => {
    if (isRecording) {
      setIsRecording(false)
      setError('')
    }
  }

  return (
    <div className="shortcut-recorder">
      <button
        ref={recorderRef}
        type="button"
        className={`shortcut-recorder-display ${isRecording ? 'is-recording' : ''}`}
        onClick={startRecording}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        title="点击录入快捷键"
      >
        {displayValue}
      </button>
      {(error || status) && (
        <span className={`shortcut-recorder-status ${error ? 'is-error' : ''}`}>
          {error || status}
        </span>
      )}
      {hint && <span className="shortcut-recorder-hint">{hint}</span>}
    </div>
  )
}

export function eventToShortcutRecorderValue(
  event: KeyboardEvent<HTMLElement>,
  lastModifierTap: LastModifierTap | null,
  allowDoubleModifier: boolean,
): { shortcut: Exclude<ShortcutRecorderValue, { kind: 'disabled' }> | null; lastModifierTap: LastModifierTap | null } {
  const now = Date.now()
  if (isModifierKey(event.key)) {
    if (!allowDoubleModifier) return { shortcut: null, lastModifierTap: null }
    const modifier =
      event.key === 'Meta' ? 'Command' :
      event.key === 'Control' && !isMacPlatform() ? 'Command' :
      event.key === 'Shift' ? 'Shift' :
      event.key === 'Alt' ? 'Option' :
      null
    if (!modifier || event.repeat) return { shortcut: null, lastModifierTap }
    if (lastModifierTap?.modifier === modifier && now - lastModifierTap.time <= 500) {
      return {
        shortcut: { kind: 'double-modifier', modifier },
        lastModifierTap: null,
      }
    }
    return {
      shortcut: null,
      lastModifierTap: { modifier, time: now },
    }
  }

  return {
    shortcut: eventToAccelerator(event),
    lastModifierTap: null,
  }
}

export function getHotkeyPlatformLabels(): HotkeyPlatformLabels {
  const isMac = isMacPlatform()
  return {
    isMac,
    command: isMac ? 'Cmd' : 'Ctrl',
    option: isMac ? 'Option' : 'Alt',
  }
}

export function doubleModifierLabel(
  modifier: GlobalPinnedLauncherDoubleModifier,
  locale: 'zh' | 'en',
  platformLabels = getHotkeyPlatformLabels(),
): string {
  return translate(locale, 'settings', 'hotkeyDoubleModifier', {
    modifier: modifierLabel(modifier, platformLabels),
  })
}

export function formatShortcutRecorderValueLabel(
  value: ShortcutRecorderValue,
  locale: 'zh' | 'en',
  platformLabels = getHotkeyPlatformLabels(),
  disabledLabel = translate(locale, 'settings', 'hotkeyDisabled'),
): string {
  if (value.kind === 'accelerator') return formatAcceleratorLabel(value.accelerator, platformLabels)
  if (value.kind === 'double-modifier') return doubleModifierLabel(value.modifier, locale, platformLabels)
  return disabledLabel
}

function eventToAccelerator(event: KeyboardEvent<HTMLElement>): Exclude<ShortcutRecorderValue, { kind: 'disabled' | 'double-modifier' }> | null {
  // Use event.code for physical key detection. This is critical for Option+Space
  // on macOS, where Option can turn the space key into a non-breaking space (\u00A0)
  // in event.key, while event.code remains 'Space'.
  let key: string | null
  if (event.code === 'Space') {
    key = 'Space'
  } else {
    key = normalizeKey(event.key)
  }

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
  if (key === ' ' || key === 'Space' || key === '\u00A0') return 'Space'
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

function modifierLabel(modifier: GlobalPinnedLauncherDoubleModifier, platformLabels: HotkeyPlatformLabels): string {
  if (modifier === 'Shift') return 'Shift'
  if (modifier === 'Option') return platformLabels.option
  return platformLabels.command
}

function formatAcceleratorLabel(accelerator: string, platformLabels: HotkeyPlatformLabels): string {
  // Always map internal names (Cmd/Alt) to platform-friendly labels.
  // This makes Option+Space show as "Option+Space" on macOS instead of "Alt+Space".
  return accelerator
    .replace(/\bCmd\b/g, platformLabels.command)
    .replace(/\bAlt\b/g, platformLabels.option)
}
