import type { LauncherHostId } from '../../workspace/launcher/types'
import type { SerializedRange } from '../../workspace/types'
import { getEditorContextSnapshot, type EditorContextSnapshot } from './editorContext'

export type ContextBrokerEditorContextSnapshot = {
  activePaneId: string
  paneIds: string[]
  language?: string
  selectedText: string
  selectionRange?: SerializedRange
  cursor?: { lineNumber: number; column: number }
}

export type GlobalInvocationContext = {
  kind: 'global-invocation'
  invocationSource: 'global-launcher'
  surfaceId: 'global-launcher'
  query?: string
  invokedAt: number
}

export type LauncherInvocationContext = GlobalInvocationContext | {
  kind: 'editor-invocation'
  invocationSource: 'editor-command-bar'
  surfaceId: 'editor-command-bar'
  editorContextSnapshot: EditorContextSnapshot
  query?: string
  invokedAt: number
}

export type ContextBroker = {
  getInvocationContext(hostId: LauncherHostId, query?: string): LauncherInvocationContext
  getEditorContextSnapshot(): ContextBrokerEditorContextSnapshot
}

export function createContextBroker(): ContextBroker {
  return {
    getInvocationContext,
    getEditorContextSnapshot,
  }
}

export function getInvocationContext(
  hostId: LauncherHostId,
  query?: string,
): LauncherInvocationContext {
  if (hostId === 'global-launcher') {
    return {
      kind: 'global-invocation',
      invocationSource: 'global-launcher',
      surfaceId: 'global-launcher',
      query,
      invokedAt: Date.now(),
    }
  }

  return {
    kind: 'editor-invocation',
    invocationSource: 'editor-command-bar',
    surfaceId: 'editor-command-bar',
    editorContextSnapshot: getEditorContextSnapshot(),
    query,
    invokedAt: Date.now(),
  }
}
