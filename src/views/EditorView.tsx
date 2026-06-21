import { useEffect, useState } from 'react'
import { useAppStore, localized } from '../store'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { WorkspaceShell } from '../components/workspace/WorkspaceShell'
import { RenderStatusBar } from '../components/workspace/RenderStatusBar'
import { PanelHost } from '../components/workspace/PanelHost'
import { PanelHostV2 } from '../components/workspace/PanelHostV2'
import { ToastContainer } from '../components/workspace/ToastContainer'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { runToolbarCommand } from '../workspace/toolbarCommandRunner'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { useT } from '../i18n'
import { formatGlobalPinnedLauncherShortcutLabel } from '../hotkeys/shortcutDisplay'
import { Command, PanelBottom, PanelRight, Search, Sparkles, WrapText } from 'lucide-react'

function isEditableSelectAllTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest(".monaco-editor, input, textarea, select, [contenteditable='true']"))
}

function isFindWidgetVisible(editor?: { getDomNode?: () => HTMLElement | null }) {
  const root = editor?.getDomNode?.() ?? document
  return Boolean(root.querySelector('.find-widget.visible:not(.hiddenEditor)'))
}

export function EditorView() {
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setGlobalLauncherOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const wordWrap = useAppStore((s) => s.settings.wordWrap)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const locale = useAppStore((s) => s.locale)
  const globalPinnedLauncherShortcut = useAppStore((s) => s.settings.globalPinnedLauncherShortcut)
  const t = useT('editor')
  const closeActiveSurfaceOrPane = useWorkspaceStore((s) => s.closeActiveSurfaceOrPane)
  const createPane = useWorkspaceStore((s) => s.createPane)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const [isFindOpen, setIsFindOpen] = useState(false)

  // Toolbar buttons contributed by plugins (top-right region), sorted by order.
  void pluginRegistryVersion
  const toolbarItems = pluginRegistry
    .getAllToolbarItems()
    .filter((item) => (item.contribution.placement ?? 'editor-top-right') === 'editor-top-right')
    .sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0))
  const runActionShortcut = formatGlobalPinnedLauncherShortcutLabel(globalPinnedLauncherShortcut, locale)
  const getActiveCodeEditor = () => {
    const workspace = useWorkspaceStore.getState()
    return workspace.activePaneId
      ? runtimeRegistry.getCodeEditor(workspace.activePaneId)
      : useAppStore.getState().editorInstance
  }
  const toggleFindReplace = () => {
    const editor = getActiveCodeEditor()
    if (!editor) return
    editor.focus?.()
    if (isFindWidgetVisible(editor)) {
      const closeAction = editor.getAction?.('closeFindWidget')
      if (closeAction) {
        void closeAction.run()
      } else {
        editor.trigger?.('editor-topbar', 'closeFindWidget', null)
      }
      setIsFindOpen(false)
      return
    }
    const action = editor.getAction?.('editor.action.startFindReplaceAction')
    if (action) {
      void action.run()
    } else {
      editor.trigger?.('editor-topbar', 'editor.action.startFindReplaceAction', null)
    }
    setIsFindOpen(true)
  }

  useEffect(() => {
    const syncFindOpen = () => setIsFindOpen(isFindWidgetVisible(getActiveCodeEditor()))
    syncFindOpen()
    const observer = new MutationObserver(syncFindOpen)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    window.addEventListener('focus', syncFindOpen)
    return () => {
      observer.disconnect()
      window.removeEventListener('focus', syncFindOpen)
    }
  }, [])

  // Route shell shortcuts before the browser document can consume them.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hasPrimaryModifier = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (hasPrimaryModifier && key === 'a') {
        if (isEditableSelectAllTarget(e.target)) return
        const workspace = useWorkspaceStore.getState()
        const editor = workspace.activePaneId
          ? runtimeRegistry.getCodeEditor(workspace.activePaneId)
          : useAppStore.getState().editorInstance
        if (!editor) return
        e.preventDefault()
        e.stopPropagation()
        editor.focus?.()
        editor.getAction('editor.action.selectAll')?.run()
        return
      }
      if (hasPrimaryModifier && key === 'w') {
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
        className="editor-topbar glass"
      >
        <div className="editor-topbar-system" aria-label="Editor actions">
          <button
            className={`editor-topbar-button ${wordWrap ? 'is-active' : ''}`}
            onClick={() => updateSetting('wordWrap', !wordWrap)}
            title={t('toggleWordWrap')}
          >
            <WrapText size={14} />
          </button>
          <button
            className={`editor-topbar-button ${isFindOpen ? 'is-active' : ''}`}
            onClick={toggleFindReplace}
            title={t('findReplace')}
            aria-pressed={isFindOpen}
          >
            <Search size={14} />
          </button>
          <span className="editor-topbar-divider" />
          <button
            className="editor-topbar-button"
            onClick={() => setGlobalLauncherOpen(true, 'full')}
            title={t('openLauncher')}
          >
            <Command size={14} />
          </button>
          <button
            className="editor-topbar-button"
            onClick={() => createPane({ text: '', focus: true, direction: 'right' })}
            title={t('splitRight')}
          >
            <PanelRight size={14} />
          </button>
          <button
            className="editor-topbar-button"
            onClick={() => createPane({ text: '', focus: true, direction: 'bottom' })}
            title={t('splitDown')}
          >
            <PanelBottom size={14} />
          </button>
        </div>

        {/* Right side: plugin toolbar buttons + Run Action */}
        <div className="editor-topbar-plugin-slot">
          {toolbarItems.map((item) => {
            const title = localized(item.contribution.title, item.contribution.titleI18n, locale)
            return (
              <button
                key={item.contribution.id}
                className="editor-topbar-button"
                onClick={() => { void runToolbarCommand(item.contribution.commandId, item.isDev) }}
                title={title}
              >
                {resolveIcon(item.contribution.icon, 12, item.contribution.id)}
              </button>
            )
          })}

          <button
            type="button"
            className="btn btn-ghost btn-sm ft-btn ft-btn-ghost ft-btn-sm editor-topbar-run"
            onClick={() => setCommandPaletteOpen(true)}
            title={t('runActionWithShortcut', { shortcut: runActionShortcut })}
          >
            <Sparkles size={13} />
            <span>{t('runAction')}</span>
          </button>
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
