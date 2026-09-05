import { useState } from 'react'
import { flushSync } from 'react-dom'
import { BrainCircuit, Settings, Puzzle, Sparkles } from 'lucide-react'
import { useT } from '../i18n'
import { AiSubscriptionsContent, SettingsContent } from '../surfaces/SettingsContent'
import { PluginsContent } from '../surfaces/PluginsContent'
import { LearnedRulesContent } from '../surfaces/LearnedRulesContent'
import './SystemSettingsSurface.css'

type TabId = 'settings' | 'ai' | 'plugins' | 'learning'

export function SystemSettingsSurface({ initialTab = 'settings' }: { initialTab?: TabId }) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const t = useT('systemSettings')

  const tabs: { id: TabId; icon: React.ReactNode; label: string }[] = [
    { id: 'settings', icon: <Settings size={16} />, label: t('basicSettings') },
    { id: 'ai', icon: <BrainCircuit size={16} />, label: t('aiSubscriptions') },
    { id: 'plugins', icon: <Puzzle size={16} />, label: t('pluginManagement') },
    { id: 'learning', icon: <Sparkles size={16} />, label: t('learnedRules') },
  ]

  const selectTab = (tabId: TabId) => {
    if (tabId === activeTab) return
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
        <div key={activeTab} className="system-settings-page">
          {activeTab === 'settings' && <SettingsContent />}
          {activeTab === 'ai' && <AiSubscriptionsContent />}
          {activeTab === 'plugins' && <PluginsContent />}
          {activeTab === 'learning' && <LearnedRulesContent />}
        </div>
      </div>
    </div>
  )
}
