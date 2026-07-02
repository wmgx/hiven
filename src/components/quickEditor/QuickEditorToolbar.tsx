import { useCallback } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import {
  closeQuickEditorWindow,
  isQuickEditorDetachedWindow,
  showQuickEditorWindow,
} from '../../workspace/windowManager/quickEditorWindow'
import { hideLauncherWindow } from '../../workspace/windowManager/launcherWindow'
import { isStandaloneLauncherWindow } from '../launcher/GlobalLauncherHostLifecycle'

export function QuickEditorToolbar() {
  const language = useQuickEditorStore((s) => s.language)
  const locale = useAppStore((s) => s.locale)
  const t = useT('quickEditor')
  const languageLabel = getLanguageOptionLabel(language, locale)
  const isDetached = isQuickEditorDetachedWindow()

  const handleDetach = useCallback(async () => {
    try {
      await showQuickEditorWindow()
      // The editor now lives in the detached window; put the launcher away.
      useAppStore.getState().setGlobalLauncherOpen(false)
      if (isStandaloneLauncherWindow()) {
        await hideLauncherWindow()
      }
    } catch (error) {
      console.warn('[hiven] Failed to detach quick editor:', error)
    }
  }, [])

  const handleCloseWindow = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  return (
    <div
      className="flex items-center justify-between px-3 h-8 shrink-0 select-none"
      style={{
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
      }}
      data-no-drag
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('title')}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {languageLabel}
        </span>
        {!isDetached && (
          <button
            type="button"
            className="flex items-center justify-center w-5 h-5 rounded transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={t('detach')}
            onClick={handleDetach}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)' }}
          >
            <ExternalLink size={12} />
          </button>
        )}
        {isDetached && (
          <button
            type="button"
            className="flex items-center justify-center w-5 h-5 rounded transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={t('closeWindow')}
            onClick={handleCloseWindow}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)' }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
