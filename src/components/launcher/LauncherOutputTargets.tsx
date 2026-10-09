/**
 * Shared package-4 output destinations (copy / paste-front / return-to-launcher).
 * Used by collect-input live preview and single-text result frames.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'
import { LauncherHintKey } from './LauncherFooterHints'
import { usePasteAvailability } from '../usePasteAvailability'
import { pasteAvailabilityMessageKey } from '../../workspace/pasteAvailability'

export type OutputDestinationId = 'primary' | 'copy' | 'paste-foreground' | 'return-to-launcher'

export type OutputDestination = {
  id: OutputDestinationId
  keys: string
  labelKey: 'outputRunAction' | 'outputCopy' | 'outputPasteForeground' | 'returnToLauncher'
}

export function buildOutputDestinations(params: {
  hasPaste: boolean
  hasReturn: boolean
  hasCopy?: boolean
  hasPrimary?: boolean
  primaryIntent?: 'copy' | 'return-to-launcher'
  metaLabel?: string
}): OutputDestination[] {
  const metaLabel = params.metaLabel ?? getPlatformShortcutMeta().label
  // ↵ copy · ⇧↵ paste front · ⌘/Ctrl↵ return to launcher
  const list: OutputDestination[] = params.hasCopy === false ? [] : [
    { id: 'copy', keys: '↵', labelKey: 'outputCopy' },
  ]
  if (params.hasPrimary) list.unshift({ id: 'primary', keys: '↵', labelKey: 'outputRunAction' })
  if (params.hasPaste) {
    list.push({ id: 'paste-foreground', keys: '⇧↵', labelKey: 'outputPasteForeground' })
  }
  if (params.hasReturn) {
    list.push({ id: 'return-to-launcher', keys: params.primaryIntent === 'return-to-launcher' ? '↵' : `${metaLabel}↵`, labelKey: 'returnToLauncher' })
  }
  return list
}

export function LauncherOutputTargetsBar({
  destinations,
  activeId,
  locale,
  onSelect,
  disabled = false,
  footerHints,
}: {
  destinations: OutputDestination[]
  activeId: OutputDestinationId
  locale: Locale
  onSelect: (id: OutputDestinationId) => void
  disabled?: boolean
  footerHints?: ReactNode
}) {
  const hasPaste = destinations.some((destination) => destination.id === 'paste-foreground')
  const pasteAvailability = usePasteAvailability(hasPaste)
  const pasteStatusId = useId()
  const blockedMessageKey = pasteAvailabilityMessageKey(pasteAvailability)
  const pasteMessage = hasPaste ? t(locale, blockedMessageKey ?? (
    pasteAvailability === 'can-attempt' ? 'palette.outputPasteCanAttempt' : 'palette.outputPasteUnknown'
  )) : undefined
  if (destinations.length === 0 && footerHints == null) return null
  // Keep the default Enter action trailing without moving focused controls when
  // the active keyboard destination changes. Other callers keep their layout.
  const visibleDestinations = footerHints == null || destinations.length < 2
    ? destinations
    : [...destinations.slice(1), destinations[0]]
  const targets = (
    <>
      {visibleDestinations.length > 0 && <div
        className="launcher-output-targets"
        data-testid="launcher-output-targets"
        role="listbox"
        aria-label={t(locale, 'palette.outputSwitchTarget')}
      >
        {visibleDestinations.map((dest) => (
          <button
            key={dest.id}
            type="button"
            role="option"
            disabled={disabled || (dest.id === 'paste-foreground' && Boolean(blockedMessageKey))}
            aria-selected={activeId === dest.id}
            aria-describedby={dest.id === 'paste-foreground' ? pasteStatusId : undefined}
            className={`launcher-output-target disabled:opacity-50 disabled:cursor-not-allowed${activeId === dest.id ? ' is-active' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(dest.id)}
          >
            {dest.keys ? <kbd>{dest.keys}</kbd> : null}
            <span>{t(locale, `palette.${dest.labelKey}`)}</span>
          </button>
        ))}
      </div>}
      {pasteMessage && (
        // Reserve room while preflight completes: native frame sizing does not
        // run again just because this status changes from unknown to blocked.
        <div id={pasteStatusId} role="status" aria-live="polite" className="min-h-14 px-3.5 pb-2 text-[11px] leading-4" style={{ color: 'var(--color-text-secondary)' }}>
          {pasteMessage}
        </div>
      )}
    </>
  )
  if (footerHints == null) return targets
  return (
    <div className="global-launcher-footer l-foot launcher-output-actionbar">
      <div className="launcher-output-hints">{footerHints}</div>
      {targets}
    </div>
  )
}

/**
 * Compact footer when the destination bar is already visible.
 * Badges carry ↵ / ⇧↵ / ⌘↵ — footer only keeps Tab + Esc so the strip is not doubled.
 */
export function LauncherOutputTargetsFooter({
  destinations,
  locale,
}: {
  destinations: OutputDestination[]
  locale: Locale
  /** @deprecated kept for call-site compatibility */
  metaLabel?: string
  hasPaste?: boolean
  hasReturn?: boolean
}) {
  if (destinations.length === 0) return null
  return (
    <>
      {destinations.length > 1 ? (
        <LauncherHintKey keys="⇥" label={t(locale, 'palette.outputSwitchTarget')} />
      ) : (
        <LauncherHintKey keys="↵" label={t(locale, `palette.${destinations[0]?.labelKey ?? 'outputCopy'}`)} />
      )}
    </>
  )
}

/** Local destination index state + keyboard helpers for Enter/Tab/Shift/Meta. */
export function useOutputDestinationState(params: {
  destinations: OutputDestination[]
  resetKey: string
}) {
  const [destIndex, setDestIndex] = useState(0)
  const activeDest = params.destinations[Math.min(destIndex, Math.max(0, params.destinations.length - 1))]
    ?? params.destinations[0]

  useEffect(() => {
    setDestIndex(0)
  }, [params.resetKey])

  const cycle = (delta: number) => {
    if (params.destinations.length < 2) return
    setDestIndex((index) => (index + delta + params.destinations.length) % params.destinations.length)
  }

  const selectId = (id: OutputDestinationId) => {
    const idx = params.destinations.findIndex((d) => d.id === id)
    if (idx >= 0) setDestIndex(idx)
  }

  const resolveFromKeyboard = (event: {
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
  }): OutputDestinationId => {
    if (event.metaKey || event.ctrlKey) {
      return params.destinations.find((d) => d.id === 'return-to-launcher')?.id ?? activeDest?.id ?? 'copy'
    }
    if (event.shiftKey) {
      // Keep blocked paste destinations in the list: this shortcut must retain
      // paste intent and let execution check again, never silently become Copy.
      return params.destinations.find((d) => d.id === 'paste-foreground')?.id ?? activeDest?.id ?? 'copy'
    }
    return activeDest?.id ?? 'copy'
  }

  return {
    activeDest,
    destIndex,
    setDestIndex,
    cycle,
    selectId,
    resolveFromKeyboard,
  }
}

export function useOutputDestinations(params: {
  hasPaste: boolean
  hasReturn: boolean
  hasCopy?: boolean
  hasPrimary?: boolean
  primaryIntent?: 'copy' | 'return-to-launcher'
  resetKey: string
}) {
  const metaLabel = getPlatformShortcutMeta().label
  const destinations = useMemo(
    () => buildOutputDestinations({
      hasPaste: params.hasPaste,
      hasReturn: params.hasReturn,
      hasCopy: params.hasCopy,
      hasPrimary: params.hasPrimary,
      primaryIntent: params.primaryIntent,
      metaLabel,
    }),
    [params.hasPaste, params.hasReturn, params.hasCopy, params.hasPrimary, params.primaryIntent, metaLabel],
  )
  const state = useOutputDestinationState({ destinations, resetKey: params.resetKey })
  return { destinations, metaLabel, ...state }
}
