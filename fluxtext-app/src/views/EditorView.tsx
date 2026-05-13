import { useEffect } from 'react'
import { useAppStore } from '../store'
import Editor from '@monaco-editor/react'
import { FileText, Type } from 'lucide-react'
import { t } from '../i18n'

export function EditorView() {
  const editorText = useAppStore((s) => s.editorText)
  const setEditorText = useAppStore((s) => s.setEditorText)
  const setEditorInstance = useAppStore((s) => s.setEditorInstance)
  const lastResult = useAppStore((s) => s.lastResult)
  const lastActionName = useAppStore((s) => s.lastActionName)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)

  // 组件卸载时清除 editor 引用，避免泄漏
  useEffect(() => {
    return () => { setEditorInstance(null) }
  }, [setEditorInstance])

  const lines = editorText.split('\n').length
  const chars = editorText.length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Status bar */}
      <div
        className="h-[26px] flex items-center px-3.5 gap-3.5 shrink-0"
        style={{
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <span className="w-1.5 h-1.5 rounded-full anim-pulse-dot" style={{ background: '#27C93F' }} />
          {t(locale, 'editor.ready')}
        </span>
        <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <FileText size={13} />
          {lines} {t(locale, 'editor.lines')}
        </span>
        <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <Type size={13} />
          {chars} {t(locale, 'editor.chars')}
        </span>
        <span
          className="ml-auto text-[11px] cursor-pointer hover:opacity-70"
          style={{ color: 'var(--color-text-tertiary)' }}
          onClick={() => setCommandPaletteOpen(true)}
        >
          {t(locale, 'editor.runAction')}
        </span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="plaintext"
          value={editorText}
          onChange={(v) => setEditorText(v || '')}
          onMount={(editor) => {
            setEditorInstance(editor)
            // 覆盖默认的 Cmd+F，直接打开带替换的查找面板
            editor.addAction({
              id: 'find-and-replace',
              label: 'Find and Replace',
              keybindings: [
                2048 /* CtrlCmd */ | 36 /* KeyF */,
                2048 /* CtrlCmd */ | 512 /* Alt */ | 36 /* KeyF */,
                2048 /* CtrlCmd */ | 35 /* KeyH */,
              ],
              run: (ed) => {
                ed.getAction('editor.action.startFindReplaceAction')?.run()
              },
            })
          }}
          options={{
            fontSize: settings.fontSize,
            lineNumbers: settings.lineNumbers ? 'on' : 'off',
            wordWrap: settings.wordWrap ? 'on' : 'off',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 12,
            lineNumbersMinChars: 4,
            padding: { top: 12 },
            fontFamily: 'var(--font-mono)',
          }}
          theme="vs"
        />
      </div>

      {/* Bottom bar */}
      <div
        className="h-7 flex items-center px-3.5 gap-2.5 shrink-0"
        style={{
          borderTop: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
          {t(locale, 'editor.output')}
        </span>
        {lastResult ? (
          <span
            key={lastActionName}
            className="text-[11px] px-1.5 py-0.5 rounded anim-badge-pop"
            style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}
          >
            {lastActionName} ✓
          </span>
        ) : (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}
          >
            —
          </span>
        )}
      </div>
    </div>
  )
}
