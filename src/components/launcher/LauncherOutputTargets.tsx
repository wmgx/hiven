/**
 * Shared package-4 output destinations (copy / paste-front / return-to-launcher).
 * Used by collect-input live preview and single-text result frames.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import { getPlatformShortcutMeta } from './launcherParamShortcuts'
import { LauncherHintKey } from './LauncherFooterHints'

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
}: {
  destinations: OutputDestination[]
  activeId: OutputDestinationId
  locale: Locale
  onSelect: (id: OutputDestinationId) => void
  disabled?: boolean
}) {
  if (destinations.length === 0) return null
  return (
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
          disabled={disabled}
          aria-selected={activeId === dest.id}
          className={`launcher-output-target${activeId === dest.id ? ' is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(dest.id)}
        >
          {dest.keys ? <kbd>{dest.keys}</kbd> : null}
          <span>{t(locale, `palette.${dest.labelKey}`)}</span>
        </button>
      ))}
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
