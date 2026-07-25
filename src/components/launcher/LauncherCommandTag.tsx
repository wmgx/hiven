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
