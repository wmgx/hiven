import { useCallback } from 'react'
import type { Locale } from '../../i18n'
import type { PluginSettingsSource, PluginSettingsFieldTarget } from '../../workspace/pluginSettingsStore'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { PluginSettingsContent } from '../PluginSettingsDialog'

export function GlobalLauncherSettingsFrame({
  pluginId,
  source,
  target,
  locale,
  height,
  onClose,
}: {
  pluginId: string
  source: PluginSettingsSource
  target?: PluginSettingsFieldTarget
  locale: Locale
  height: number
  onClose: () => void
}) {
  const escapeHandler = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return true
  }, [onClose])
  useLauncherEscapeInterceptor(escapeHandler)

  return (
    <div
      className="global-launcher-settings-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height }}
    >
      <PluginSettingsContent
        pluginId={pluginId}
        source={source}
        target={target}
        locale={locale}
        onClose={onClose}
      />
    </div>
  )
}
