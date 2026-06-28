import type { PanelPropsV2 } from '../../workspace/pluginTypes'

export const WORKFLOW_OUTPUT_SHELF_PANEL_ID = 'workflow-output-shelf'

type WorkflowOutputShelfInputs = {
  text?: string
}

export function WorkflowOutputShelfPanel({ inputs, host }: PanelPropsV2<WorkflowOutputShelfInputs>) {
  const text = typeof inputs?.text === 'string' ? inputs.text : ''

  return (
    <div className="workflow-output-shelf-panel">
      <div className="workflow-output-shelf-titlebar">
        <div className="workflow-output-shelf-title">Output Shelf</div>
        <button className="workflow-output-shelf-close" type="button" onClick={host.close}>x</button>
      </div>
      <pre className="workflow-output-shelf-body">{text}</pre>
    </div>
  )
}
