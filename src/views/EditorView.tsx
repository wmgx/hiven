import { useEffect } from 'react'
import { useAppStore, localized } from '../store'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { WorkspaceShell } from '../components/workspace/WorkspaceShell'
import { RenderStatusBar } from '../components/workspace/RenderStatusBar'
import { PanelHost } from '../components/workspace/PanelHost'
import { PanelHostV2 } from '../components/workspace/PanelHostV2'
import { ToastContainer } from '../components/workspace/ToastContainer'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { runToolbarCommand } from '../workspace/toolbarCommandRunner'
import { resolveIcon } from '../utils/resolveIcon'
import { useT } from '../i18n'

export function EditorView() {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const locale = useAppStore((s) => s.locale)
  const t = useT('editor')
  const closeActiveSurfaceOrPane = useWorkspaceStore((s) => s.closeActiveSurfaceOrPane)
  const pluginRegistryVersion = usePluginRegistryVersion()

  // Toolbar buttons contributed by plugins (top-right region), sorted by order.
  void pluginRegistryVersion
  const toolbarItems = pluginRegistry
    .getAllToolbarItems()
    .filter((item) => (item.contribution.placement ?? 'editor-top-right') === 'editor-top-right')
    .sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0))

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
          <span className="w-1.5 h-1.5 rounded-full anim-pulse-dot" style={{ background: 'var(--color-success)' }} />
          {t('ready')}
        </span>

        {/* Right side: plugin toolbar buttons + Run Action */}
        <div className="ml-auto flex items-center gap-1.5">
          {toolbarItems.map((item) => {
            const title = localized(item.contribution.title, item.contribution.titleI18n, locale)
            return (
              <button
                key={item.contribution.id}
                className="ft-btn-icon-sm"
                onClick={() => { void runToolbarCommand(item.contribution.commandId, item.isDev) }}
                title={title}
              >
                {resolveIcon(item.contribution.icon, 12, item.contribution.id)}
              </button>
            )
          })}

          <span
            className="ft-btn ft-btn-ghost ft-btn-sm"
            onClick={() => setCommandPaletteOpen(true)}
          >
            {t('runAction')}
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
