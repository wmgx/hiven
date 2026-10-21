import { useState } from 'react'
import { flushSync } from 'react-dom'
import { BrainCircuit, Settings, Puzzle } from 'lucide-react'
import { useT } from '../i18n'
import { AiSubscriptionsContent, SettingsContent } from '../surfaces/SettingsContent'
import { PluginsContent } from '../surfaces/PluginsContent'
import './SystemSettingsSurface.css'

type TabId = 'settings' | 'ai' | 'plugins'

export function SystemSettingsSurface({ initialTab = 'settings' }: { initialTab?: TabId }) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  // Tabs stay mounted once visited so unsaved drafts survive switching tabs.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabId>>(() => new Set([initialTab]))
  const t = useT('systemSettings')

  const tabs: { id: TabId; icon: React.ReactNode; label: string }[] = [
    { id: 'settings', icon: <Settings size={16} />, label: t('basicSettings') },
    { id: 'ai', icon: <BrainCircuit size={16} />, label: t('aiSubscriptions') },
    { id: 'plugins', icon: <Puzzle size={16} />, label: t('pluginManagement') },
  ]

  const selectTab = (tabId: TabId) => {
    if (tabId === activeTab) return
    setVisitedTabs((current) => (current.has(tabId) ? current : new Set(current).add(tabId)))
    const startViewTransition = (document as Document & {
      startViewTransition?: (update: () => void) => void
    }).startViewTransition
    if (!startViewTransition) {
      setActiveTab(tabId)
      return
    }
    startViewTransition.call(document, () => flushSync(() => setActiveTab(tabId)))
  }

  return (
    <div className={`system-settings-surface ${typeof document.startViewTransition === 'function' ? 'supports-view-transitions' : ''}`}>
      <div className="system-settings-sidebar" data-launcher-scrollable>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`system-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            aria-label={tab.label}
            title={tab.label}
            onClick={() => selectTab(tab.id)}
          >
            <span className="system-settings-tab-icon">{tab.icon}</span>
            <span className="system-settings-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="system-settings-content" data-launcher-scrollable>
        {visitedTabs.has('settings') && (
          <div className="system-settings-page" hidden={activeTab !== 'settings'}><SettingsContent /></div>
        )}
        {visitedTabs.has('ai') && (
          <div className="system-settings-page" hidden={activeTab !== 'ai'}><AiSubscriptionsContent /></div>
        )}
        {visitedTabs.has('plugins') && (
          <div className="system-settings-page" hidden={activeTab !== 'plugins'}><PluginsContent /></div>
        )}
      </div>
    </div>
  )
}
