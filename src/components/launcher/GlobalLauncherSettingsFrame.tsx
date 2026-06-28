import type { Locale } from '../../i18n'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { PluginSettingsContent } from '../PluginSettingsDialog'

export function GlobalLauncherSettingsFrame({
  pluginId,
  source,
  locale,
  height,
  onClose,
}: {
  pluginId: string
  source: PluginSettingsSource
  locale: Locale
  height: number
  onClose: () => void
}) {
  return (
    <div
      className="global-launcher-settings-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height }}
    >
      <PluginSettingsContent
        pluginId={pluginId}
        source={source}
        locale={locale}
        onClose={onClose}
      />
    </div>
  )
}
