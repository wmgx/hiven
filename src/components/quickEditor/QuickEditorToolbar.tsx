import { useCallback } from 'react'
import { ExternalLink } from 'lucide-react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { useAppStore } from '../../store'
import { showQuickEditorWindow, isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'

export function QuickEditorToolbar() {
  const language = useQuickEditorStore((s) => s.language)
  const locale = useAppStore((s) => s.locale)
  const closeQuickEditor = useAppStore((s) => s.closeQuickEditor)
  const languageLabel = getLanguageOptionLabel(language, locale)
  const isDetached = isQuickEditorDetachedWindow()

  const handleDetach = useCallback(async () => {
    try {
      await showQuickEditorWindow()
      // Close the inline editor after detach
      closeQuickEditor()
    } catch (error) {
      console.warn('[hiven] Failed to detach quick editor:', error)
    }
  }, [closeQuickEditor])

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
          Quick Editor
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
            title="Detach to window"
            onClick={handleDetach}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)' }}
          >
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
