import { useAppStore, type PluginSurfaceOpenTarget } from '../store'
import { applyEffects } from '../workspace/effectRunner'
import { createPluginPaste } from '../workspace/pluginPaste'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { showEditorWindow } from '../workspace/windowManager/editorWindow'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import type { FluxEffect, SerializedRange } from '../workspace/types'
import type { OutputTarget, TextOutput } from './outputTarget'

export type OutputRouterResult =
  | { ok: true; target: OutputTarget['type']; message?: string }
  | { ok: false; target: OutputTarget['type']; message: string }

export type OutputRouter = {
  routeText(output: TextOutput | string, target: OutputTarget): Promise<OutputRouterResult>
}

export function createOutputRouter(): OutputRouter {
  return {
    routeText: routeTextOutput,
  }
}

export async function routeTextOutput(
  output: TextOutput | string,
  target: OutputTarget,
): Promise<OutputRouterResult> {
  const textOutput = normalizeTextOutput(output)

  try {
    switch (target.type) {
      case 'copy':
        await writeText(textOutput.text)
        return { ok: true, target: target.type }
      case 'paste-to-foreground-app': {
        const result = await createPluginPaste().pasteText(textOutput.text)
        if (result.ok || result.fallback === 'copied') {
          return { ok: true, target: target.type, message: result.message }
        }
        return { ok: false, target: target.type, message: result.message }
      }
      case 'replace-editor-selection':
        replaceEditorSelection(textOutput.text, target.paneId, target.range)
        return { ok: true, target: target.type }
      case 'insert-into-editor':
        insertIntoEditor(textOutput.text, target.paneId, target.range)
        return { ok: true, target: target.type }
      case 'open-in-editor':
        await showEditorWindow({
          initialText: textOutput.text,
          title: target.title ?? textOutput.title,
          language: target.language ?? textOutput.language,
        })
        return { ok: true, target: target.type }
      case 'open-plugin-surface':
        await openPluginSurface(target.target)
        return { ok: true, target: target.type }
      case 'attach-editor-panel':
        openPanel(textOutput, target)
        return { ok: true, target: target.type }
      case 'save-to-shelf':
        return {
          ok: false,
          target: target.type,
          message: 'save-to-shelf is not wired yet',
        }
      default:
        return {
          ok: false,
          target: (target as OutputTarget).type,
          message: `Unsupported output target: ${(target as OutputTarget).type}`,
        }
    }
  } catch (error) {
    return {
      ok: false,
      target: target.type,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function normalizeTextOutput(output: TextOutput | string): TextOutput {
  return typeof output === 'string' ? { text: output } : output
}

async function writeText(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
    return
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

function replaceEditorSelection(
  text: string,
  targetPaneId?: string,
  targetRange?: SerializedRange,
): void {
  const state = useWorkspaceStore.getState()
  const paneId = targetPaneId ?? state.activePaneId
  const range = targetRange ?? getSelectionRange(paneId)
  applyEffects([{
    type: 'text.replace',
    target: range ? { paneId, range } : 'active-input',
    text,
  }])
}

function insertIntoEditor(
  text: string,
  targetPaneId?: string,
  targetRange?: SerializedRange,
): void {
  const state = useWorkspaceStore.getState()
  const paneId = targetPaneId ?? state.activePaneId
  const range = targetRange ?? getCursorRange(paneId)

  if (range) {
    applyEffects([{ type: 'text.replace', target: { paneId, range }, text }])
    return
  }

  applyEffects([{
    type: 'text.replace',
    target: 'active-input',
    text: `${state.getActivePaneText()}${text}`,
  }])
}

function getSelectionRange(paneId: string): SerializedRange | undefined {
  const editor = runtimeRegistry.getCodeEditor(paneId)
  const selection = editor?.getSelection?.()
  if (!selection || selection.isEmpty?.()) return undefined
  return {
    startLineNumber: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber,
    endColumn: selection.endColumn,
  }
}

function getCursorRange(paneId: string): SerializedRange | undefined {
  const editor = runtimeRegistry.getCodeEditor(paneId)
  const position = editor?.getPosition?.()
  if (!position) return getSelectionRange(paneId)
  return {
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  }
}

async function openPluginSurface(target: PluginSurfaceOpenTarget): Promise<void> {
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    await showPluginSurfaceWindow(target)
    return
  }
  useAppStore.getState().openPluginSurfaceTool(target)
}

function openPanel(
  output: TextOutput,
  target: Extract<OutputTarget, { type: 'attach-editor-panel' }>,
): void {
  const effects: FluxEffect[] = [{
    type: 'panel.openV2',
    panelId: target.panelId,
    placement: target.placement,
    inputs: target.inputs ?? output,
    title: target.title ?? output.title,
    ownerPluginId: target.ownerPluginId,
    scope: target.scope,
  }]
  applyEffects(effects)
}
