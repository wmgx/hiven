/**
 * RecommendedActionRow — A single recommended action in the object-action list.
 *
 * Step 5 design language:
 *   格式化剪贴板 JSON                              Enter
 *   来自 JSON Tools · 复制结果 · Tab 预览
 *
 * Provider is product identity. Raw plugin ids stay implementation details.
 */

import type { RecommendedAction } from '../../launcher/clipboard/actionRecommendation'
import { getOutputTargetLabel } from '../../launcher/clipboard/actionExecutor'

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
  const provider = action.provider ?? action.pluginId
  const outputLabel = getOutputTargetLabel(action.defaultOutput)

  return (
    <div
      className={`recommended-action-row${selected ? ' selected' : ''}`}
      data-testid="recommended-action-row"
      data-action-id={action.id}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <span className="action-title">{action.titleZh}</span>
      <span className="action-key-hint">Enter</span>
      <span className="action-meta">
        {provider && <span className="action-provider">来自 {provider}</span>}
        <span className="action-default-output">{outputLabel}</span>
        {(action.alternativeOutputs?.length ?? 0) > 0 && <span className="action-preview-hint">Tab 输出</span>}
      </span>
    </div>
  )
}
