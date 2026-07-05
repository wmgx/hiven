import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { useAppStore } from '../../store'
import { EditorSurface } from '../editor/EditorSurface'
import type { EditorTextBinding } from '../editor/editorSurfaceTypes'
import { QuickEditorCommandOverlay } from './QuickEditorCommandOverlay'
import { suppressStandaloneLauncherBlur } from '../../workspace/launcherBlurGuard'
import { useQuickEditorEscape } from './useQuickEditorEscape'
import { isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'
import { quickEditorImperative } from './quickEditorImperative'
import { useT } from '../../i18n'

export function QuickEditorPanel({ onRequestExit }: { onRequestExit: () => void }) {
  const text = useQuickEditorStore((s) => s.text)
  const language = useQuickEditorStore((s) => s.language)
  const languageSource = useQuickEditorStore((s) => s.languageSource)
  const setText = useQuickEditorStore((s) => s.setText)
  const setDetectedLanguage = useQuickEditorStore((s) => s.setDetectedLanguage)
  const setCursorPosition = useQuickEditorStore((s) => s.setCursorPosition)
  const setScrollPosition = useQuickEditorStore((s) => s.setScrollPosition)
  const openQuickEditorCommand = useAppStore((s) => s.openQuickEditorCommand)

  const { exitHintVisible } = useQuickEditorEscape(onRequestExit)
  const tQuickEditor = useT('quickEditor')
  const isDetached = isQuickEditorDetachedWindow()

  // 现场恢复只发生在挂载时：用 ref 冻结初始值，避免编辑期间反向写回
  const initialCursorRef = useRef(useQuickEditorStore.getState().cursorPosition)
  const initialScrollRef = useRef(useQuickEditorStore.getState().scrollPosition)

  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    event.stopPropagation()
    suppressStandaloneLauncherBlur()
    openQuickEditorCommand()
  }, [openQuickEditorCommand])

  const binding: EditorTextBinding = {
    text,
    language,
    languageSource,
    onTextChange: setText,
    onDetectedLanguage: setDetectedLanguage,
    initialCursor: initialCursorRef.current,
    initialScroll: initialScrollRef.current,
    onCursorChange: setCursorPosition,
    onScrollChange: setScrollPosition,
  }

  return (
    <div className="h-full" onKeyDownCapture={handleKeyDownCapture} data-no-drag>
      <EditorSurface
        binding={binding}
        autoFocus
        actions={[{
          id: 'quick-editor-command',
          label: 'Quick Editor Command',
          keybindings: [2048 | 41],
          run: () => {
            suppressStandaloneLauncherBlur()
            useAppStore.getState().openQuickEditorCommand()
          },
        }]}
        onReady={(editor) => {
          quickEditorImperative.registerFind(() => {
            editor.getAction('editor.action.startFindReplaceAction')?.run()
          })
          return () => {
            quickEditorImperative.unregisterFind()
          }
        }}
        overlay={(
          <>
            {exitHintVisible && (
              <div
                className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-40 px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: 'var(--color-background-tertiary)',
                  color: 'var(--color-text-secondary)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
                }}
              >
                {isDetached ? tQuickEditor('escCloseHint') : tQuickEditor('escExitHint')}
              </div>
            )}
            <QuickEditorCommandOverlay />
          </>
        )}
      />
    </div>
  )
}
