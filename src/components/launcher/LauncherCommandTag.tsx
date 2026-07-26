/**
 * LauncherCommandTag — blue command label in the shared input-row protocol (package 4).
 * Visual cousin of ObjectBlockToken; not clipboard semantics.
 */

import { X } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { IconRef } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'

export function LauncherCommandTag({
  title,
  icon,
  onRemove,
  locale,
}: {
  title: string
  icon?: IconRef
  onRemove: () => void
  locale: Locale
}) {
  return (
    <span
      className="launcher-command-tag"
      data-testid="launcher-command-tag"
      title={title}
    >
      {icon != null && (
        <span className="launcher-command-tag-ico" aria-hidden>
          {resolveIcon(icon, 12, title)}
        </span>
      )}
      <span className="launcher-command-tag-title">{title}</span>
      <button
        type="button"
        className="launcher-command-tag-remove"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label={t(locale, 'palette.commandTagRemove')}
      >
        <X size={12} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </span>
  )
}

/** Lightweight gray value chip for committed params beside the command tag. */
export function LauncherParamValueChip({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <span
      className="launcher-param-chip"
      data-testid="launcher-param-chip"
      title={`${label}: ${value}`}
    >
      {value}
    </span>
  )
}

const MAX_VISIBLE_PARAM_CHIPS = 2

/**
 * Committed param trail: keep the row single-line.
 * Shows the most recent chips; older ones collapse into +N (title lists all).
 */
export function LauncherParamChipTrail({
  chips,
  maxVisible = MAX_VISIBLE_PARAM_CHIPS,
}: {
  chips: Array<{ label: string; value: string }>
  maxVisible?: number
}) {
  if (chips.length === 0) return null
  const limit = Math.max(1, maxVisible)
  const overflow = chips.length > limit ? chips.slice(0, chips.length - limit) : []
  const visible = chips.length > limit ? chips.slice(-limit) : chips
  const overflowTitle = overflow.map((chip) => `${chip.label}: ${chip.value}`).join('\n')

  return (
    <span className="launcher-param-chip-trail" data-testid="launcher-param-chip-trail">
      {overflow.length > 0 && (
        <span
          className="launcher-param-chip launcher-param-chip-more"
          data-testid="launcher-param-chip-more"
          title={overflowTitle}
        >
          +{overflow.length}
        </span>
      )}
      {visible.map((chip) => (
        <LauncherParamValueChip key={`${chip.label}:${chip.value}`} label={chip.label} value={chip.value} />
      ))}
    </span>
  )
}
