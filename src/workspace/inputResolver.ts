/**
 * hiven Workspace Extension - Input Resolver
 * Resolves CommandInput based on active pane, selection, and InputPolicy.
 */

import type { CommandInput, InputPolicy, PaneId, SerializedRange } from './types'
import { useWorkspaceStore } from './workspaceStore'
import { runtimeRegistry } from './runtimeRegistry'
import { getActiveEditorContextSnapshot } from './editorBridge'
import type { EditorContextSnapshot } from '../launcher/context/contextBroker'

export function resolveInput(policy?: InputPolicy): CommandInput {
  if (!isEditorWindowRuntime() && canReadEditorContextSnapshot()) {
    const editorContext = getActiveEditorContextSnapshot()
    if (editorContext) return resolveEditorContextInput(editorContext, policy)
  }

  const state = useWorkspaceStore.getState()
  const activePaneId = state.activePaneId
  const pane = state.panes[activePaneId]
  if (!pane) {
    return { mode: 'whole-pane', text: '', paneId: activePaneId }
  }

  const editor = runtimeRegistry.getCodeEditor(activePaneId)

  // Check for selection
  if (editor) {
    const sel = editor.getSelection()
    if (sel && !sel.isEmpty()) {
      const selectedText = editor.getModel()?.getValueInRange(sel) || ''
      const range: SerializedRange = {
        startLineNumber: sel.startLineNumber,
        startColumn: sel.startColumn,
        endLineNumber: sel.endLineNumber,
        endColumn: sel.endColumn,
      }

      // If policy prefers workspace, skip selection
      if (policy?.prefer === 'workspace') {
        return resolveWorkspaceInput(state, policy)
      }

      return {
        mode: 'selection',
        text: selectedText,
        range,
        paneId: activePaneId,
      }
    }
  }

  // No selection: check policy preference
  if (policy?.prefer === 'workspace') {
    return resolveWorkspaceInput(state, policy)
  }

  // Default: whole-pane
  return {
    mode: 'whole-pane',
    text: pane.text,
    paneId: activePaneId,
  }
}

function resolveEditorContextInput(editorContext: EditorContextSnapshot, policy?: InputPolicy): CommandInput {
  if (policy?.prefer === 'workspace') {
    return {
      mode: 'workspace',
      paneId: editorContext.activePaneId,
      panes: editorContext.paneIds,
      text: editorContext.activeText || '',
    }
  }

  if (editorContext.selectedText && policy?.prefer !== 'whole-pane') {
    return {
      mode: 'selection',
      text: editorContext.selectedText,
      range: editorContext.selectionRange,
      paneId: editorContext.activePaneId,
    }
  }

  return {
    mode: 'whole-pane',
    text: editorContext.activeText || '',
    paneId: editorContext.activePaneId,
  }
}

function isEditorWindowRuntime(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'editor'
  } catch {
    return false
  }
}

function canReadEditorContextSnapshot(): boolean {
  return typeof window !== 'undefined'
}

function resolveWorkspaceInput(
  state: ReturnType<typeof useWorkspaceStore.getState>,
  policy: InputPolicy
): CommandInput {
  const paneIds = state.paneOrder
  return {
    mode: 'workspace',
    paneId: state.activePaneId,
    panes: paneIds,
    text: state.panes[state.activePaneId]?.text || '',
  }
}
