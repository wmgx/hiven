import { useAppStore } from '../../store'
import { openExternalUrl } from '../effectRunner'
import type { FluxEffect, SerializedRange } from '../types'
import type { PluginLauncherApi } from '../launcher/types'
import { useQuickEditorStore } from './quickEditorStore'
import { readQuickEditorPaneSnapshot } from './quickEditorPaneSnapshot'

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

function offsetAt(text: string, position: { lineNumber: number; column: number }): number {
  const lines = splitLines(text)
  const lineIndex = Math.max(0, Math.min(position.lineNumber - 1, lines.length - 1))
  let offset = 0
  for (let i = 0; i < lineIndex; i += 1) offset += lines[i].length + 1
  return offset + Math.max(0, Math.min(position.column - 1, lines[lineIndex]?.length ?? 0))
}

function replaceRange(text: string, range: SerializedRange, replacement: string): string {
  const start = offsetAt(text, range as never)
  const end = offsetAt(text, {
    lineNumber: range.endLineNumber,
    column: range.endColumn,
  })
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`
}

export function applyEffectsToQuickEditor(effects: FluxEffect[]) {
  const applied: FluxEffect[] = []
  const errors: string[] = []
  const store = useQuickEditorStore.getState()

  for (const effect of effects) {
    try {
      switch (effect.type) {
        case 'text.replace': {
          const current = useQuickEditorStore.getState().text
          if (effect.target !== 'active-input' && effect.target.range) {
            store.setText(replaceRange(current, effect.target.range, effect.text))
          } else {
            store.setText(effect.text)
          }
          applied.push(effect)
          break
        }
        case 'pane.update': {
          if (effect.patch.language) store.setLanguage(effect.patch.language)
          if (effect.patch.text !== undefined) store.setText(effect.patch.text)
          applied.push(effect)
          break
        }
        case 'pane.create': {
          if (effect.pane.language) store.setLanguage(effect.pane.language)
          if (effect.pane.text !== undefined) store.setText(String(effect.pane.text))
          applied.push(effect)
          break
        }
        case 'status.message':
          useAppStore.getState().setLastCommandStatus({
            title: effect.message,
            status: effect.level === 'error' ? 'error' : 'success',
            message: effect.message,
            updatedAt: Date.now(),
          })
          applied.push(effect)
          break
        default:
          errors.push(`Quick Editor cannot apply effect: ${effect.type}`)
      }
    } catch (error) {
      errors.push(`Quick Editor effect ${effect.type} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { applied, errors }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.warn('[quick-editor] clipboard write failed:', error)
    }
  }
}

async function readClipboard(): Promise<string> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return (await readText()) ?? ''
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}

export function createQuickEditorLauncherApi(baseApi: PluginLauncherApi): PluginLauncherApi {
  return {
    ...baseApi,
    getActiveText: () => useQuickEditorStore.getState().text,
    getSelectionText: () => '',
    getPaneSnapshot: () => {
      // Prefer the merged host snapshot (editor + quick editor) when available;
      // fall back to live quick-editor panes so diff always sees local panels.
      const merged = baseApi.getPaneSnapshot()
      if (merged.paneIds.length > 0) return merged
      const quick = readQuickEditorPaneSnapshot()
      if (!quick) {
        return {
          activePaneId: '',
          previousActivePaneId: undefined,
          paneIds: [],
          panes: {},
          renderers: {},
        }
      }
      return {
        activePaneId: quick.activePaneId,
        previousActivePaneId: undefined,
        paneIds: quick.paneIds,
        panes: quick.panes,
        renderers: {},
      }
    },
    getClipboardText: () => readClipboard(),
    replaceActiveText: async (text: string) => {
      useQuickEditorStore.getState().setText(text)
    },
    insertText: async (text: string) => {
      const state = useQuickEditorStore.getState()
      const current = state.text
      const offset = offsetAt(current, state.cursorPosition)
      state.setText(`${current.slice(0, offset)}${text}${current.slice(offset)}`)
    },
    copyText: writeClipboard,
    openUrl: async (url: string) => {
      await openExternalUrl(url)
    },
    dispatchEffects: applyEffectsToQuickEditor,
    showMessage: (message: string, level = 'info') => {
      useAppStore.getState().setLastCommandStatus({
        title: message,
        status: level === 'error' ? 'error' : 'success',
        message,
        updatedAt: Date.now(),
      })
    },
  }
}
