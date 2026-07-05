import { useCallback } from 'react'
import { Search, WrapText, X } from 'lucide-react'
import { useAppStore } from '../store'
import { useQuickEditorStore } from '../workspace/quickEditor/quickEditorStore'
import { getLanguageOptionLabel } from '../workspace/languageOptions'
import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'
import { closeQuickEditorWindow } from '../workspace/windowManager/quickEditorWindow'
import { quickEditorImperative } from '../components/quickEditor/quickEditorImperative'
import { useT } from '../i18n'

/**
 * Root view for the detached Quick Editor window.
 * Uses the same editor-topbar style as the full editor.
 */
export function QuickEditorDetachedView() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const wordWrap = useAppStore((s) => s.settings.wordWrap)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const locale = useAppStore((s) => s.locale)
  const language = useQuickEditorStore((s) => s.language)
  const tEditor = useT('editor')
  const tQuickEditor = useT('quickEditor')
  const languageLabel = getLanguageOptionLabel(language, locale)

  const handleRequestExit = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  return (
    <div
      className="quick-editor-detached-window h-screen w-screen overflow-hidden flex flex-col"
      data-theme={theme}
      style={{ fontSize }}
    >
      <div className="editor-topbar glass">
        <div className="editor-topbar-system">
          <button
            type="button"
            className={`editor-topbar-button${wordWrap ? ' is-active' : ''}`}
            onClick={() => updateSetting('wordWrap', !wordWrap)}
            title={tEditor('toggleWordWrap')}
          >
            <WrapText size={14} />
          </button>
          <button
            type="button"
            className="editor-topbar-button"
            onClick={() => quickEditorImperative.triggerFind()}
            title={tEditor('findReplace')}
          >
            <Search size={14} />
          </button>
        </div>
        <div className="editor-topbar-plugin-slot">
          <span className="editor-topbar-status">{languageLabel}</span>
          <button
            type="button"
            className="editor-topbar-button"
            title={tQuickEditor('closeWindow')}
            onClick={handleRequestExit}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <QuickEditorPanel onRequestExit={handleRequestExit} />
      </div>
    </div>
  )
}
