import { useCallback } from 'react'
import { ExternalLink, Search, WrapText } from 'lucide-react'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { quickEditorImperative } from './quickEditorImperative'
import { showQuickEditorWindow } from '../../workspace/windowManager/quickEditorWindow'
import { hideLauncherWindow } from '../../workspace/windowManager/launcherWindow'
import { isStandaloneLauncherWindow } from '../launcher/GlobalLauncherHostLifecycle'

export function QuickEditorBreadcrumbActions() {
  const wordWrap = useAppStore((s) => s.settings.wordWrap)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const tEditor = useT('editor')
  const tQuickEditor = useT('quickEditor')

  const handleDetach = useCallback(async () => {
    try {
      useAppStore.getState().setGlobalLauncherOpen(false)
      if (isStandaloneLauncherWindow()) {
        await hideLauncherWindow()
      }
      await showQuickEditorWindow()
    } catch (error) {
      console.warn('[hiven] Failed to detach quick editor:', error)
    }
  }, [])

  return (
    <>
      <button
        type="button"
        className={`editor-topbar-button${wordWrap ? ' is-active' : ''}`}
        onClick={() => updateSetting('wordWrap', !wordWrap)}
        title={tEditor('toggleWordWrap')}
      >
        <WrapText size={13} />
      </button>
      <button
        type="button"
        className="editor-topbar-button"
        onClick={() => quickEditorImperative.triggerFind()}
        title={tEditor('findReplace')}
      >
        <Search size={13} />
      </button>
      <span className="editor-topbar-divider" />
      <button
        type="button"
        className="editor-topbar-button"
        title={tQuickEditor('detach')}
        onClick={handleDetach}
      >
        <ExternalLink size={13} />
      </button>
    </>
  )
}
