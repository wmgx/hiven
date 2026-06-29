/**
 * RecommendedActionRow — A single recommended action in the object-action list.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §3
 *
 * UI:
 *   格式化剪贴板 JSON
 *   来自 JSON Tools · 输出：复制 / 打开到编辑器
 */

import type { RecommendedAction } from '../../launcher/clipboard/actionRecommendation'

const OUTPUT_LABELS: Record<string, string> = {
  copy: '复制',
  'paste-to-foreground': '粘贴到当前应用',
  'open-editor': '打开到编辑器',
  'open-plugin-surface': '打开工具',
}

export function RecommendedActionRow({
  action,
  selected,
  onSelect,
  onHover,
}: {
  action: RecommendedAction
  selected: boolean
  onSelect: () => void
  onHover: () => void
}) {
  const outputLabels = [action.defaultOutput, ...(action.alternativeOutputs ?? [])]
    .map((t) => OUTPUT_LABELS[t] ?? t)
    .join(' / ')

  return (
    <div
      className={`recommended-action-row${selected ? ' selected' : ''}`}
      data-testid="recommended-action-row"
      data-action-id={action.id}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <span className="action-title">{action.titleZh}</span>
      <span className="action-meta">
        {action.pluginId && <span className="action-plugin">来自 {action.pluginId}</span>}
        <span className="action-outputs">输出：{outputLabels}</span>
      </span>
    </div>
  )
}
