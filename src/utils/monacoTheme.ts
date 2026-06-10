import type * as Monaco from 'monaco-editor'
import type { AppTheme } from '../store'

let registered = false

export function registerFluxMonacoThemes(monacoApi: typeof Monaco) {
  if (registered) return
  registered = true
  monacoApi.editor.defineTheme('flux-vscode-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0f1012',
      'editorGutter.background': '#0f1012',
      'editorLineNumber.foreground': '#7d828a',
      'editorLineNumber.activeForeground': '#c7ccd4',
      'editor.lineHighlightBackground': '#242628',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#c7ccd4',
      'editorWhitespace.foreground': '#3a3d41',
    },
  })
  monacoApi.editor.defineTheme('flux-vscode-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editorGutter.background': '#ffffff',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#24292f',
      'editor.lineHighlightBackground': '#f1f3f5',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#24292f',
      'editorWhitespace.foreground': '#d0d7de',
    },
  })
}

export function getFluxMonacoTheme(theme: AppTheme) {
  return theme === 'dark' ? 'flux-vscode-dark' : 'flux-vscode-light'
}
