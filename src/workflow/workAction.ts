import type { OutputTarget } from './outputTarget'
import type { WorkObject } from './workObject'

export type WorkActionContext<TObject extends WorkObject = WorkObject> = {
  object: TObject
  target?: OutputTarget
}

export type WorkActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string }

export type WorkAction<TObject extends WorkObject = WorkObject> = {
  id: string
  title: string
  objectKinds: string[]
  run: (ctx: WorkActionContext<TObject>) => Promise<WorkActionResult> | WorkActionResult
}

export type WorkActionProvider = (
  object: WorkObject,
) => Promise<WorkAction[]> | WorkAction[]
