import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

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
