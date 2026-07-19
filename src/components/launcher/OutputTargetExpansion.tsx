/**
 * OutputTargetExpansion — Expanded output target list for a recommended action.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §8
 *
 * Shown when user presses Tab or → on a recommended action.
 * Lists all available output targets: copy / paste / open editor / open tool.
 */

import type { RecommendedAction, RecommendedOutputTarget } from '../../launcher/clipboard/actionRecommendation'
import { getActionOutputTargets, getOutputTargetLabel } from '../../launcher/clipboard/actionExecutor'

export function OutputTargetExpansion({
  action,
  selectedIndex,
  onSelect,
  onHover,
  onBack,
}: {
  action: RecommendedAction
  selectedIndex: number
  onSelect: (target: RecommendedOutputTarget) => void
  onHover: (index: number) => void
  onBack: () => void
}) {
  const targets = getActionOutputTargets(action)

  return (
    <div className="output-target-expansion" data-testid="output-target-expansion">
      <div className="output-target-header">
        <button type="button" className="back" onClick={onBack}>‹</button>
        <span className="title">{action.titleZh}</span>
      </div>
      <div className="output-target-list">
        {targets.map((target, index) => (
          <div
            key={target}
            className={`output-target-row${index === selectedIndex ? ' selected' : ''}`}
            data-target={target}
            onClick={() => onSelect(target)}
            onMouseEnter={() => onHover(index)}
          >
            <span className="target-label">{getOutputTargetLabel(target)}</span>
            {index === 0 && <span className="target-hint">默认</span>}
          </div>
        ))}
      </div>
      <div className="output-target-footer">
        <span className="hint">↵ 确认 · esc 返回</span>
      </div>
    </div>
  )
}
