import { useState } from 'react'
import { Settings, Puzzle } from 'lucide-react'
import { useT } from '../i18n'
import { SettingsContent } from '../surfaces/SettingsContent'
import { PluginsContent } from '../surfaces/PluginsContent'
import { requestOpenPluginEditorSurface } from '../surfaces/pluginEditorSurfaceBridge'
import type { PluginSurfaceProps } from '../workspace/pluginTypes'
import './SystemSettingsSurface.css'

type TabId = 'settings' | 'plugins'

export function SystemSettingsSurface(_props: PluginSurfaceProps) {
  const [activeTab, setActiveTab] = useState<TabId>('settings')
  const t = useT('systemSettings')

  const tabs: { id: TabId; icon: React.ReactNode; label: string }[] = [
    { id: 'settings', icon: <Settings size={16} />, label: t('basicSettings') },
    { id: 'plugins', icon: <Puzzle size={16} />, label: t('pluginManagement') },
  ]

  return (
    <div className="system-settings-surface">
      <div className="system-settings-sidebar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`system-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="system-settings-tab-icon">{tab.icon}</span>
            <span className="system-settings-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="system-settings-content">
        {activeTab === 'settings' && (
          <div className="settings-page body">
            <SettingsContent />
          </div>
        )}
        {activeTab === 'plugins' && (
          <div className="scripts-content body">
            <PluginsContent onOpenPluginEditor={requestOpenPluginEditorSurface} />
          </div>
        )}
      </div>
    </div>
  )
}
