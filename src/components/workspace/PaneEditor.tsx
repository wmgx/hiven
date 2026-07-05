import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import { RendererHost } from './RendererHost'
import { PaneBottomPanels } from './PaneBottomPanels'
import { EditorSurface } from '../editor/EditorSurface'
import type { EditorTextBinding } from '../editor/editorSurfaceTypes'
import { useT } from '../../i18n'
import { X } from 'lucide-react'

interface PaneEditorProps {
  paneId: string
}

export function PaneEditor({ paneId }: PaneEditorProps) {
  const pane = useWorkspaceStore((s) => s.panes[paneId])
  const setPaneText = useWorkspaceStore((s) => s.setPaneText)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const setPaneSelection = useWorkspaceStore((s) => s.setPaneSelection)
  const updatePaneDetectedLanguage = useWorkspaceStore((s) => s.updatePaneDetectedLanguage)
  const closePane = useWorkspaceStore((s) => s.closePane)
  const layout = useWorkspaceStore((s) => s.layout)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const rendererState = useWorkspaceStore((s) => s.paneRenderers[paneId])
  const t = useT('editor')

  if (!pane) return null

  // If a plugin renderer is active, show RendererHost instead of Monaco.
  if (rendererState) {
    return (
      <div className="h-full" onPointerDown={() => setActivePaneId(paneId)}>
        <RendererHost paneId={paneId} rendererState={rendererState} />
      </div>
    )
  }

  const languageSource = pane.languageSource
    ?? (pane.language && pane.language !== 'plaintext' ? 'manual' : 'auto')

  const binding: EditorTextBinding = {
    text: pane.text ?? '',
    language: pane.language || 'plaintext',
    languageSource,
    onTextChange: (text) => setPaneText(paneId, text),
    onSelectionChange: (selection) => setPaneSelection(paneId, selection),
    onDetectedLanguage: (language) => updatePaneDetectedLanguage(paneId, language),
  }

  const visiblePaneIds = layout.panes
  const paneNumber = visiblePaneIds.indexOf(paneId) + 1
  const showPaneNumber = visiblePaneIds.length > 1 && paneNumber > 0

  return (
    <div className="flex flex-col h-full" onPointerDown={() => setActivePaneId(paneId)}>
      <EditorSurface
        binding={binding}
        stickyScroll={pane.stickyScroll === true}
        onFocus={() => setActivePaneId(paneId)}
        onReady={(editor) => {
          runtimeRegistry.registerCodeEditor(paneId, editor)
          return () => {
            runtimeRegistry.unregisterCodeEditor(paneId)
          }
        }}
        actions={[{
          id: 'close-pane',
          label: 'Close Pane',
          keybindings: [2048 | 53],
          run: () => {
            useWorkspaceStore.getState().closeActiveSurfaceOrPane()
          },
        }]}
        bottomPanels={<PaneBottomPanels paneId={paneId} />}
        statusBarLeading={showPaneNumber ? (
          <span
            className="pane-status-index shrink-0"
            title={pane.title}
            data-active={activePaneId === paneId ? 'true' : 'false'}
          >
            {paneNumber}
          </span>
        ) : undefined}
        statusBarTrailing={(
          <button
            type="button"
            className="pane-status-close"
            title={t('closePane')}
            onClick={(event) => {
              event.stopPropagation()
              closePane(paneId)
            }}
          >
            <X size={11} />
          </button>
        )}
      />
    </div>
  )
}
