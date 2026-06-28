import type { Locale } from '../../i18n'
import type { PluginSurfaceOpenTarget } from '../../store'
import { PluginSurfaceRenderer } from '../pluginSurface/PluginSurfaceRenderer'

export function GlobalLauncherPluginSurfaceFrame({
  target,
  locale,
  shellHeight,
  onBack,
  onClose,
}: {
  target: PluginSurfaceOpenTarget
  locale: Locale
  shellHeight: number
  onBack: () => void
  onClose: () => void
}) {
  return (
    <div
      className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height: shellHeight }}
    >
      <div className="global-launcher-body" style={{ maxHeight: shellHeight, height: shellHeight, overflow: 'hidden' }}>
        <PluginSurfaceRenderer
          target={target}
          locale={locale}
          presentation="global-launcher"
          contextSurfaceId="global-launcher"
          onBack={onBack}
          onClose={onClose}
        />
      </div>
    </div>
  )
}
