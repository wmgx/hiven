import { useAppStore } from '../store'
import type { ViewId } from '../store'
import { LayoutPanelLeft, Pin, Puzzle, Terminal, Settings } from 'lucide-react'
import { t } from '../i18n'
import { resolveIcon } from '../utils/resolveIcon'

const navItems: { id: ViewId; icon: React.ReactNode; labelKey: 'nav.editor' | 'nav.scripts' | 'nav.debugger' }[] = [
  { id: 'editor', icon: <LayoutPanelLeft size={18} />, labelKey: 'nav.editor' },
  { id: 'scripts', icon: <Puzzle size={18} />, labelKey: 'nav.scripts' },
  { id: 'debugger', icon: <Terminal size={18} />, labelKey: 'nav.debugger' },
]

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const activePinnedActionId = useAppStore((s) => s.activePinnedActionId)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const locale = useAppStore((s) => s.locale)

  return (
    <div
      className="w-[44px] flex flex-col items-center py-2 gap-1 shrink-0"
      style={{
        borderRight: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
      }}
    >
      {navItems.map((item) => (
        <button
          key={item.id}
          title={t(locale, item.labelKey)}
          onClick={() => setActiveView(item.id)}
          className={`sidebar-btn w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none bg-transparent ${activeView === item.id ? 'active' : ''}`}
          style={{
            color: activeView === item.id ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
        >
          <span className="flex items-center justify-center">{item.icon}</span>
        </button>
      ))}
      <div
        className="w-5 my-1"
        style={{ height: '0.5px', background: 'var(--color-border-tertiary)' }}
      />
      {pinnedActions.length > 0 && (
        <div className="flex flex-col items-center gap-1" aria-label="Pinned">
          {pinnedActions.map((pinned) => (
            <button
              key={pinned.id}
              title={`Pinned · ${pinned.title}`}
              onClick={() => openPinnedAction(pinned.id)}
              className={`sidebar-btn w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none bg-transparent ${activeView === 'pinned-runner' && activePinnedActionId === pinned.id ? 'active' : ''}`}
              style={{
                color: activeView === 'pinned-runner' && activePinnedActionId === pinned.id ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
              }}
            >
              <span className="flex items-center justify-center">
                {pinned.icon ? resolveIcon(pinned.icon, 16, pinned.title) : <Pin size={16} />}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-auto">
        <button
          title={t(locale, 'nav.settings')}
          onClick={() => setActiveView('settings')}
          className={`sidebar-btn w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none bg-transparent ${activeView === 'settings' ? 'active' : ''}`}
          style={{
            color: activeView === 'settings' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
        >
          <span className="flex items-center justify-center"><Settings size={18} /></span>
        </button>
      </div>
    </div>
  )
}
