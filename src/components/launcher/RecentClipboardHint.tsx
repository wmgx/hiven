/**
 * RecentClipboardHint — Weak hint shown when clipboard is 2–10 min old.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §9.3
 *
 * UI: "最近剪贴板 · 6 分钟前 · 使用这段内容"
 */

import type { RecentClipboardHint as HintType } from '../../launcher/clipboard/objectBlock'
import { getKindLabel } from '../../launcher/clipboard/objectBlock'

export function RecentClipboardHint({
  hint,
  onAttach,
}: {
  hint: HintType
  onAttach: () => void
}) {
  return (
    <div
      className="recent-clipboard-hint"
      data-testid="recent-clipboard-hint"
    >
      <span className="hint-label">
        最近剪贴板 · {getKindLabel(hint.kind)} · {hint.ageLabel}
      </span>
      <button
        type="button"
        className="hint-action"
        onClick={onAttach}
      >
        使用这段内容
      </button>
    </div>
  )
}
