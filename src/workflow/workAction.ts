import type { WorkObject, WorkObjectType } from './workObject'
import type { ActionResult, OutputTarget } from './outputTarget'
import type { WorkContextSnapshot } from '../launcher/context/contextBroker'

export type ContextRequirement =
  | { kind: 'selected-text' }
  | { kind: 'clipboard' }
  | { kind: 'editor-pane' }
  | { kind: 'foreground-app' }

export type WorkContext = {
  snapshot: WorkContextSnapshot
}

export type WorkAction = {
  id: string
  title: string
  icon?: string
  accepts: WorkObjectType[]
  requiresContext?: ContextRequirement[]
  defaultOutputTarget?: OutputTarget['kind']
  run(input: WorkObject, ctx: WorkContext): Promise<ActionResult> | ActionResult
}

export type WorkActionProvider = {
  id: string
  getActions(input: WorkObject, ctx: WorkContext): Promise<WorkAction[]> | WorkAction[]
}
