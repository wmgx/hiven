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
      { token: 'operator', foreground: '8ab4f8' },
      { token: 'string', foreground: '9db0d8' },
      { token: 'number', foreground: 'f2b36d' },
      { token: 'regexp', foreground: 'f29ba7' },
      { token: 'type', foreground: '7fc7ff' },
      { token: 'class', foreground: '7fc7ff' },
      { token: 'function', foreground: '93c5fd' },
      { token: 'variable', foreground: 'e4e8f0' },
      { token: 'constant', foreground: 'f2b36d' },
      { token: 'delimiter', foreground: '95a0b2' },
      { token: 'tag', foreground: 'ff9fb2' },
      { token: 'attribute.name', foreground: 'ffd38a' },
      { token: 'attribute.value', foreground: '7dd3a8' },
    ],
    colors: {
      'editor.background': '#242427',
      'editorGutter.background': '#242427',
      'editor.foreground': '#f2f2f4',
      'editorLineNumber.foreground': '#6d6d75',
      'editorLineNumber.activeForeground': '#a0a0a8',
      'editor.lineHighlightBackground': '#2e2e32',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#f2f2f4',
      'editorWhitespace.foreground': '#43434a',
      'editor.selectionBackground': '#28446f',
      'editor.inactiveSelectionBackground': '#34363d',
      'editor.findMatchBackground': '#5b4a25',
      'editor.findMatchHighlightBackground': '#423920',
      'editorBracketMatch.background': '#334155',
      'editorBracketMatch.border': '#3b82f6',
      'editorBracketHighlight.foreground1': '#95a0b2',
      'editorBracketHighlight.foreground2': '#3b82f6',
      'editorBracketHighlight.foreground3': '#7fc7ff',
      'editorBracketHighlight.foreground4': '#9db0d8',
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
