/**
 * RecentClipboardHint — Recommendation card shown when clipboard is 2–10 min old.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §9.3
 *
 * Renders as a subtle card at the top of the launcher list with content preview.
 */

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
  onAttach,
}: {
  hint: HintType
  onAttach: () => void
}) {
  const preview = truncatePreview(hint.snapshot.text)
  const kindLabel = getKindLabel(hint.kind)

  return (
    <div
      className="recent-clipboard-hint"
      data-testid="recent-clipboard-hint"
      onClick={onAttach}
    >
      <div className="hint-icon">📋</div>
      <div className="hint-body">
        {preview && (
          <span className="hint-title">{preview}</span>
        )}
        <span className="hint-subtitle">
          {hint.ageLabel}复制 · {kindLabel}
        </span>
      </div>
      <div className="hint-enter">↵</div>
    </div>
  )
}
