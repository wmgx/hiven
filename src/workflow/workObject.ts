import type { LauncherItemDisplay } from '../workspace/launcher/types'

export type WorkObjectKind =
  | 'clipboard'
  | 'app'
  | 'window'
  | 'editor-document'
  | 'editor-context'
  | 'text'
  | string

export type WorkObject<TPayload = unknown> = {
  id: string
  kind: WorkObjectKind
  display: LauncherItemDisplay
  payload: TPayload
  source?: string
  updatedAt?: number
  metadata?: Record<string, unknown>
}

export type WorkObjectProviderContext = {
  query: string
  surfaceId: string
}

export type WorkObjectProvider = (
  ctx: WorkObjectProviderContext,
) => Promise<WorkObject[]> | WorkObject[]
