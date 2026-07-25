/**
 * RecentClipboardHint — Recommendation card shown when clipboard is 2–10 min old.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §9.3
 *
 * Renders as a subtle card at the top of the launcher list with content preview.
 * Keyboard: selectedIndex === -1 focuses this row; only then does Enter attach.
 */

import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { RecentClipboardHint as HintType } from '../../launcher/clipboard/objectBlock'
import { getKindLabel } from '../../launcher/clipboard/objectBlock'

function truncatePreview(text: string, maxLen = 60): string {
  const firstLine = text.split('\n')[0] ?? ''
  const trimmed = firstLine.trim()
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen) + '…'
}

export function RecentClipboardHint({
  hint,
  selected,
  locale = 'zh',
  onAttach,
}: {
  hint: HintType
  selected?: boolean
  locale?: Locale
  onAttach: () => void
}) {
  const preview = truncatePreview(hint.snapshot.text)
  const kindLabel = getKindLabel(hint.kind)

  return (
    <div
      className={`recent-clipboard-hint${selected ? ' is-selected' : ''}`}
      data-testid="recent-clipboard-hint"
      data-selected={selected ? 'true' : undefined}
      role="option"
      aria-selected={selected ? true : false}
      onClick={onAttach}
    >
      <div className="hint-icon" aria-hidden="true">📋</div>
      <div className="hint-body">
        {preview && (
          <span className="hint-title">{preview}</span>
        )}
        <span className="hint-subtitle">
          {t(locale, 'palette.recentClipboardHintSubtitle', {
            age: hint.ageLabel,
            kind: kindLabel,
          })}
        </span>
      </div>
      <div className="hint-enter" aria-hidden="true">↵</div>
    </div>
  )
}
