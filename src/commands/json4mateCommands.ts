/**
 * FluxText - JSON4Mate Command
 * Demonstrates combined effects: text.replace + monaco.decorate for errors.
 * Validates that a Command can produce multiple effect types atomically.
 */

import { useWorkspaceStore } from '../workspace/workspaceStore'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { applyEffects } from '../workspace/effectRunner'
import type { ActionDef } from '../store'
import type { FluxEffect } from '../workspace/types'

/**
 * Parse JSON and return either formatted text + success effects,
 * or error decorations + status effects (no text replacement).
 */
function buildJsonEffects(text: string, mode: 'pretty' | 'compact', hasSelection: boolean): FluxEffect[] {
  const effects: FluxEffect[] = []
  const ws = useWorkspaceStore.getState()
  const activePaneId = ws.activePaneId

  try {
    const obj = JSON.parse(text)
    const formatted = mode === 'compact'
      ? JSON.stringify(obj)
      : JSON.stringify(obj, null, 2)

    // Text replace effect
    effects.push({
      type: 'text.replace',
      target: 'active-input',
      text: formatted,
    })

    // Success status
    effects.push({
      type: 'status.message',
      level: 'success',
      message: `JSON formatted (${mode})`,
    })

    // If full-text (no selection) and pretty mode, add subtle decorations
    // to highlight JSON structure (keys vs values)
    if (!hasSelection && mode === 'pretty') {
      // Clear previous JSON decorations
      effects.push({
        type: 'monaco.decorate',
        paneId: activePaneId,
        decorations: [], // Clear existing json4mate decorations
        owner: 'json4mate',
      })
    }
  } catch (e: any) {
    // Parse failed: DO NOT replace text
    // Instead, show error decoration at the error position + status message

    effects.push({
      type: 'status.message',
      level: 'error',
      message: `JSON parse error: ${e.message}`,
    })

    // Try to extract error position from the error message
    const posMatch = e.message.match(/position (\d+)/)
    const errorPos = posMatch ? parseInt(posMatch[1], 10) : 0

    // Create error decoration at the error position
    const editor = runtimeRegistry.getCodeEditor(activePaneId)
    if (editor) {
      const model = editor.getModel()
      if (model && errorPos > 0) {
        const pos = model.getPositionAt(errorPos)
        const lineLength = model.getLineLength(pos.lineNumber)
        effects.push({
          type: 'monaco.decorate',
          paneId: activePaneId,
          decorations: [{
            range: {
              startLineNumber: pos.lineNumber,
              startColumn: 1,
              endLineNumber: pos.lineNumber,
              endColumn: lineLength + 1,
            },
            options: {
              className: 'json-error-line',
              glyphMarginClassName: 'json-error-glyph',
              overviewRuler: {
                color: '#ef4444',
                position: 1,
              },
              hoverMessage: { value: `**JSON Error:** ${e.message}` },
              isWholeLine: true,
              inlineClassName: 'json-error-inline',
            },
          }],
          owner: 'json4mate',
        })
      } else {
        // Mark first line if we can't determine position
        effects.push({
          type: 'monaco.decorate',
          paneId: activePaneId,
          decorations: [{
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: 'json-error-line',
              hoverMessage: { value: `**JSON Error:** ${e.message}` },
            },
          }],
          owner: 'json4mate',
        })
      }
    }
  }

  return effects
}

export const json4mateAction: ActionDef = {
  name: 'json4mate',
  title: 'JSON4Mate (Format + Validate)',
  titleI18n: { zh: 'JSON4Mate (格式化 + 验证)' },
  icon: 'braces',
  tags: ['json', 'format', 'validate'],
  builtin: true,
  run: (text) => {
    const ws = useWorkspaceStore.getState()
    const activePaneId = ws.activePaneId
    const editor = runtimeRegistry.getCodeEditor(activePaneId)

    let inputText = text
    let hasSelection = false

    if (editor) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        inputText = editor.getModel()?.getValueInRange(sel) || text
        hasSelection = true
      }
    }

    const effects = buildJsonEffects(inputText, 'pretty', hasSelection)
    applyEffects(effects)
    return undefined as any
  },
}

export const json4mateCompactAction: ActionDef = {
  name: 'json4mate-compact',
  title: 'JSON4Mate Compact',
  titleI18n: { zh: 'JSON4Mate 压缩' },
  icon: 'braces',
  tags: ['json', 'format', 'compact'],
  builtin: true,
  run: (text) => {
    const ws = useWorkspaceStore.getState()
    const activePaneId = ws.activePaneId
    const editor = runtimeRegistry.getCodeEditor(activePaneId)

    let inputText = text
    let hasSelection = false

    if (editor) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        inputText = editor.getModel()?.getValueInRange(sel) || text
        hasSelection = true
      }
    }

    const effects = buildJsonEffects(inputText, 'compact', hasSelection)
    applyEffects(effects)
    return undefined as any
  },
}

export const json4mateActions: ActionDef[] = [json4mateAction, json4mateCompactAction]
