import { useEffect } from 'react'
import { useAppStore } from '../store'
import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'
import { closeQuickEditorWindow } from '../workspace/windowManager/quickEditorWindow'

/**
 * Root view for the detached Quick Editor window.
 * Shares the same quickEditorStore, so content stays in sync.
 */
export function QuickEditorDetachedView() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)

  // Escape closes detached window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        void closeQuickEditorWindow()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      data-theme={theme}
      style={{ fontSize }}
    >
      <QuickEditorPanel />
    </div>
  )
}
