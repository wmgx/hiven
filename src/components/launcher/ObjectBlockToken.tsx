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
    >
      <span className="object-block-label">
        {block.title}
        {block.subtitle && <> · {block.subtitle}</>}
        {block.ageLabel && <> · {block.ageLabel}</>}
      </span>
      {block.secretMasked && (
        <span className="object-block-masked">预览已隐藏</span>
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
