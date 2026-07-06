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
import type { QuickEditorPaneId, QuickEditorPaneState } from '../../workspace/quickEditor/quickEditorTypes'
import { X } from 'lucide-react'

export function QuickEditorPanel({ onRequestExit }: { onRequestExit: () => void }) {
  const panes = useQuickEditorStore((s) => s.panes)
  const paneOrder = useQuickEditorStore((s) => s.paneOrder)
  const splitDirection = useQuickEditorStore((s) => s.splitDirection)
  const openQuickEditorCommand = useAppStore((s) => s.openQuickEditorCommand)

  const { exitHintVisible } = useQuickEditorEscape(onRequestExit)
  const tQuickEditor = useT('quickEditor')
  const isDetached = isQuickEditorDetachedWindow()

  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.key.toLowerCase() === 'w') {
      if (useQuickEditorStore.getState().paneOrder.length <= 1) return
      event.preventDefault()
      event.stopPropagation()
      useQuickEditorStore.getState().closeActivePane()
      return
    }
    if (event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    event.stopPropagation()
    suppressStandaloneLauncherBlur()
    openQuickEditorCommand()
  }, [openQuickEditorCommand])

  const visiblePanes = paneOrder.map((paneId) => panes[paneId]).filter(Boolean)
  const isHorizontal = splitDirection === 'horizontal'

  return (
    <div className="relative h-full" onKeyDownCapture={handleKeyDownCapture} data-no-drag>
      <div className={`h-full min-h-0 flex ${isHorizontal ? 'flex-row' : 'flex-col'}`}>
        {visiblePanes.map((pane, index) => (
          <div
            key={pane.id}
            className="min-w-0 min-h-0 flex-1"
            style={{
              borderLeft: isHorizontal && index > 0 ? '0.5px solid var(--color-border-tertiary)' : undefined,
              borderTop: !isHorizontal && index > 0 ? '0.5px solid var(--color-border-tertiary)' : undefined,
            }}
          >
            <QuickEditorPaneSurface pane={pane} autoFocus={index === visiblePanes.length - 1} />
          </div>
        ))}
      </div>
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
    </div>
  )
}

function QuickEditorPaneSurface({
  pane,
  autoFocus,
}: {
  pane: QuickEditorPaneState
  autoFocus: boolean
}) {
  const setActivePaneId = useQuickEditorStore((s) => s.setActivePaneId)
  const paneOrder = useQuickEditorStore((s) => s.paneOrder)
  const closePane = useQuickEditorStore((s) => s.closePane)
  const tEditor = useT('editor')
  const initialCursorRef = useRef(pane.cursorPosition)
  const initialScrollRef = useRef(pane.scrollPosition)

  const updatePane = useCallback((
    paneId: QuickEditorPaneId,
    apply: () => void,
  ) => {
    useQuickEditorStore.getState().setActivePaneId(paneId)
    apply()
  }, [])

  const binding: EditorTextBinding = {
    text: pane.text,
    language: pane.language,
    languageSource: pane.languageSource,
    onTextChange: (text) => updatePane(pane.id, () => useQuickEditorStore.getState().setText(text)),
    onDetectedLanguage: (language) => updatePane(pane.id, () => useQuickEditorStore.getState().setDetectedLanguage(language)),
    initialCursor: initialCursorRef.current,
    initialScroll: initialScrollRef.current,
    onCursorChange: (position) => updatePane(pane.id, () => useQuickEditorStore.getState().setCursorPosition(position)),
    onScrollChange: (position) => updatePane(pane.id, () => useQuickEditorStore.getState().setScrollPosition(position)),
  }

  return (
    <EditorSurface
      binding={binding}
      autoFocus={autoFocus}
      actions={[{
        id: 'quick-editor-command',
        label: 'Quick Editor Command',
        keybindings: [2048 | 41],
        run: () => {
          suppressStandaloneLauncherBlur()
          useAppStore.getState().openQuickEditorCommand()
        },
      }, {
        id: 'quick-editor-close-pane',
        label: 'Close Quick Editor Pane',
        keybindings: [2048 | 53],
        run: () => {
          useQuickEditorStore.getState().closeActivePane()
        },
      }]}
      onFocus={() => setActivePaneId(pane.id)}
      statusBarTrailing={paneOrder.length > 1 ? (
        <button
          type="button"
          className="pane-status-close"
          title={tEditor('closePane')}
          onClick={(event) => {
            event.stopPropagation()
            closePane(pane.id)
          }}
        >
          <X size={11} />
        </button>
      ) : undefined}
      onReady={(editor) => {
        const registerActiveEditor = () => {
          quickEditorImperative.registerFind(() => {
            editor.getAction('editor.action.startFindReplaceAction')?.run()
          })
          quickEditorImperative.registerFocus(() => {
            editor.focus()
          })
        }
        if (useQuickEditorStore.getState().activePaneId === pane.id) registerActiveEditor()
        const focusSubscription = editor.onDidFocusEditorText(registerActiveEditor)
        return () => {
          focusSubscription.dispose()
          if (useQuickEditorStore.getState().activePaneId === pane.id) {
            quickEditorImperative.unregisterFind()
            quickEditorImperative.unregisterFocus()
          }
        }
      }}
    />
  )
}
