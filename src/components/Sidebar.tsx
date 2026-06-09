import type { ReactNode } from 'react'
import { localized, useAppStore } from '../store'
import type { ViewId } from '../store'
import { LayoutPanelLeft, Pin, Puzzle, Settings } from 'lucide-react'
import { useT } from '../i18n'
import { resolveIcon } from '../utils/resolveIcon'

const navItems: { id: ViewId; icon: ReactNode; labelKey: string }[] = [
  { id: 'editor', icon: <LayoutPanelLeft size={18} />, labelKey: 'editor' },
  { id: 'scripts', icon: <Puzzle size={18} />, labelKey: 'scripts' },
]

function SidebarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="sidebar-nav-item relative">
      <button
        aria-label={label}
        onClick={onClick}
        className={`sidebar-btn w-8 h-8 flex items-center justify-center cursor-pointer border-none bg-transparent ${active ? 'active' : ''}`}
        style={{
          color: active ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span className="flex items-center justify-center">{children}</span>
      </button>
      <span className="sidebar-tooltip" role="tooltip">
        {label}
      </span>
    </div>
  )
}

export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const activePinnedActionId = useAppStore((s) => s.activePinnedActionId)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const locale = useAppStore((s) => s.locale)
  const t = useT('nav')

  return (
    <div
      className="w-[44px] flex flex-col items-center py-2 gap-1 shrink-0"
      style={{
        borderRight: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
      }}
    >
      {navItems.map((item) => (
        <SidebarButton
          key={item.id}
          label={t(item.labelKey)}
          active={activeView === item.id}
          onClick={() => setActiveView(item.id)}
        >
          {item.icon}
        </SidebarButton>
      ))}
      <div
        className="w-5 my-1"
        style={{ height: '0.5px', background: 'var(--color-border-tertiary)' }}
      />
      {pinnedActions.length > 0 && (
        <div className="flex flex-col items-center gap-1" aria-label="Pinned">
          {pinnedActions.map((pinned) => {
            const label = localized(pinned.title, pinned.titleI18n, locale)
            return (
              <SidebarButton
                key={pinned.id}
                label={label}
                active={activeView === 'pinned-runner' && activePinnedActionId === pinned.id}
                onClick={() => openPinnedAction(pinned.id)}
              >
                {pinned.icon ? resolveIcon(pinned.icon, 16, pinned.title) : <Pin size={16} />}
              </SidebarButton>
            )
          })}
        </div>
      )}
      <div className="mt-auto">
        <SidebarButton
          label={t('settings')}
          active={activeView === 'settings'}
          onClick={() => setActiveView('settings')}
        >
          <Settings size={18} />
        </SidebarButton>
      </div>
    </div>
  )
}
