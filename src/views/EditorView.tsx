import { useEffect } from 'react'
import { useAppStore } from '../store'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { WorkspaceShell } from '../components/workspace/WorkspaceShell'
import { RenderStatusBar } from '../components/workspace/RenderStatusBar'
import { PanelHost } from '../components/workspace/PanelHost'
import { PanelHostV2 } from '../components/workspace/PanelHostV2'
import { ToastContainer } from '../components/workspace/ToastContainer'
import { Plus } from 'lucide-react'
import { t } from '../i18n'

export function EditorView() {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const locale = useAppStore((s) => s.locale)
  const createPane = useWorkspaceStore((s) => s.createPane)
  const closeActiveSurfaceOrPane = useWorkspaceStore((s) => s.closeActiveSurfaceOrPane)

  // Cmd+W to close active pane
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault()
        e.stopPropagation()
        closeActiveSurfaceOrPane()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [closeActiveSurfaceOrPane])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
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

        {/* Right side: Split button + Run Action */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="flex items-center justify-center w-[22px] h-[18px] rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}
            onClick={() => createPane({ text: '', language: 'plaintext', focus: true, direction: 'right' })}
            title={locale === 'zh' ? '向右分栏' : 'Split Right'}
          >
            <Plus size={12} />
          </button>

          <span
            className="text-[11px] cursor-pointer px-1.5 py-0.5 rounded"
            style={{ color: 'var(--color-text-tertiary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-background-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => setCommandPaletteOpen(true)}
          >
            {t(locale, 'editor.runAction')}
          </span>
        </div>
      </div>

      {/* Main area: left panel + workspace + right panel */}
      <div className="flex flex-row flex-1 overflow-hidden">
        {/* Left panel */}
        <PanelHostV2 placement="left" />

        {/* Center: workspace + bottom panels */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Workspace */}
          <WorkspaceShell />

          {/* Panel Host (bottom panels - legacy system) */}
          <PanelHost />

          {/* Panel Host V2 (bottom plugin panels) */}
          <PanelHostV2 placement="bottom" />
        </div>

        {/* Right panel */}
        <PanelHostV2 placement="right" />
      </div>

      {/* Render Status */}
      <RenderStatusBar />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
