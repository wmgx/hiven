import { useCallback } from 'react'
import { useAppStore } from '../store'
import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'
import { closeQuickEditorWindow } from '../workspace/windowManager/quickEditorWindow'

/**
 * Root view for the detached Quick Editor window.
 * Shares the same quickEditorStore; two-stage Escape lives inside the panel.
 */
export function QuickEditorDetachedView() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)

  const handleRequestExit = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      data-theme={theme}
      style={{ fontSize }}
    >
      <QuickEditorPanel onRequestExit={handleRequestExit} />
    </div>
  )
}
