/**
 * ObjectBlockToken — Visual token in the launcher input bar representing
 * the attached clipboard/editor-selection object.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §2.4 / §10
 *
 * UI:
 *   [ 剪贴板 · JSON · 12 秒前  × ]
 *   When selectedForDelete: purple border + "再按 Backspace 删除"
 *   When secretMasked: "预览已隐藏"
 */

import type { LauncherObjectBlock } from '../../launcher/clipboard/objectBlock'

function truncatePreview(text: string, maxLen: number): string {
  const singleLine = text.replace(/[\r\n]+/g, ' ').trim()
  if (singleLine.length <= maxLen) return singleLine
  return singleLine.slice(0, maxLen) + '…'
}

export function ObjectBlockToken({
  block,
  onRemove,
}: {
  block: LauncherObjectBlock
  onRemove: () => void
}) {
  const selected = block.selectedForDelete
  return (
    <span
      className={`object-block-token${selected ? ' selected-for-delete' : ''}`}
      data-testid="object-block-token"
      data-source={block.source}
      data-kind={block.kind}
      data-selected={selected ? 'true' : undefined}
      data-state={selected ? 'selected-for-deletion' : block.state}
    >
      {!block.secretMasked && block.preview ? (
        <span className="object-block-content">{truncatePreview(block.preview, 30)}</span>
      ) : block.secretMasked ? (
        <span className="object-block-masked">内容已隐藏</span>
      ) : (
        <span className="object-block-content">{block.title}</span>
      )}
      {block.state === 'snapshot' && (
        <span className="object-block-badge">snapshot</span>
      )}
      {block.validity === 'invalid' && (
        <span className="object-block-badge">invalid</span>
      )}
      {selected && (
        <span className="object-block-delete-hint">再按 Backspace 删除</span>
      )}
      <button
        type="button"
        className="object-block-remove"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label="Remove object block"
      >
        ×
      </button>
    </span>
  )
}
