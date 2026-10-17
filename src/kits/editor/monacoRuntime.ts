import { loader } from '@monaco-editor/react'
import * as monacoCore from 'monaco-editor/esm/vs/editor/edcore.main'
import './monacoEditorFeatures'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

/** The Monaco API backed by the trimmed feature set (no TS/CSS/HTML language services). */
export const monaco = monacoCore as unknown as typeof import('monaco-editor')

let configured = false

export function configureMonacoRuntime(): void {
  if (configured) return
  configured = true
  self.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      return label === 'json' ? new jsonWorker() : new editorWorker()
    },
  }
  loader.config({ monaco })
}
