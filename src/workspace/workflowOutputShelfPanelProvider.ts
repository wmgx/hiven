import { WorkflowOutputShelfPanel, WORKFLOW_OUTPUT_SHELF_PANEL_ID } from '../components/workflow/WorkflowOutputShelfPanel'
import { pluginRegistry } from './pluginRegistry'
import type { PanelContributionV2 } from './pluginTypes'

let registered = false

export function registerWorkflowOutputShelfPanelProvider(): void {
  if (registered) return
  registered = true

  const panel: PanelContributionV2 = {
    id: WORKFLOW_OUTPUT_SHELF_PANEL_ID,
    title: 'Output Shelf',
    titleI18n: { zh: '输出架' },
    defaultPlacement: 'right',
    component: WorkflowOutputShelfPanel as never,
  }

  pluginRegistry.registerProductionPlugin(
    'hiven.workflow-output-shelf',
    [],
    [],
    [panel],
    [],
  )
}
