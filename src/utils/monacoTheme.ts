import type * as Monaco from 'monaco-editor'
import type { AppTheme } from '../store'

let registered = false

export function registerFluxMonacoThemes(monacoApi: typeof Monaco) {
  if (registered) return
  registered = true
  monacoApi.editor.defineTheme('flux-vscode-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'e4e8f0' },
      { token: 'comment', foreground: '748095', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'operator', foreground: '89a2ff' },
      { token: 'string', foreground: '7dd3a8' },
      { token: 'number', foreground: 'f2b36d' },
      { token: 'regexp', foreground: 'f29ba7' },
      { token: 'type', foreground: '7fc7ff' },
      { token: 'class', foreground: '7fc7ff' },
      { token: 'function', foreground: 'e3a95f' },
      { token: 'variable', foreground: 'e4e8f0' },
      { token: 'constant', foreground: 'f2b36d' },
      { token: 'delimiter', foreground: '95a0b2' },
      { token: 'tag', foreground: 'ff9fb2' },
      { token: 'attribute.name', foreground: 'ffd38a' },
      { token: 'attribute.value', foreground: '7dd3a8' },
    ],
    colors: {
      'editor.background': '#111318',
      'editorGutter.background': '#111318',
      'editor.foreground': '#e4e8f0',
      'editorLineNumber.foreground': '#8d96a3',
      'editorLineNumber.activeForeground': '#f4f7fb',
      'editor.lineHighlightBackground': '#202634',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#f4f7fb',
      'editorWhitespace.foreground': '#4a5261',
      'editor.selectionBackground': '#2e3650',
      'editor.inactiveSelectionBackground': '#252b3b',
      'editor.findMatchBackground': '#5b4a25',
      'editor.findMatchHighlightBackground': '#423920',
      'editorBracketMatch.background': '#323a52',
      'editorBracketMatch.border': '#d99a4e',
      'editorBracketHighlight.foreground1': '#95a0b2',
      'editorBracketHighlight.foreground2': '#d99a4e',
      'editorBracketHighlight.foreground3': '#7fc7ff',
      'editorBracketHighlight.foreground4': '#7dd3a8',
      'editorBracketHighlight.foreground5': '#c792ea',
      'editorBracketHighlight.foreground6': '#f2b36d',
      'editorBracketHighlight.unexpectedBracket.foreground': '#f29ba7',
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
