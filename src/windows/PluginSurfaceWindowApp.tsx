import { useEffect, useMemo, type ReactNode } from 'react'
import { localized, useAppStore, type PluginSurfaceOpenTarget } from '../store'
import { PluginSettingsDialog } from '../components/PluginSettingsDialog'
import { usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { hidePluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { PluginSurfaceRenderer } from '../components/pluginSurface/PluginSurfaceRenderer'
import { resolvePluginSurface } from '../components/pluginSurface/pluginSurfaceResolver'

export function PluginSurfaceWindowApp() {
  const target = useMemo(() => readPluginSurfaceTargetFromLocation(), [])
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const locale = useAppStore((s) => s.locale)
  const registryVersion = usePluginRegistryVersion()

  useEffect(() => {
    if (!target) return
    void useAppStore.persist.rehydrate()
    void usePluginSettingsStore.persist.rehydrate()
  }, [target])

  const resolved = useMemo(() => {
    void registryVersion
    if (!target) return null
    return resolvePluginSurface(target)
  }, [target, registryVersion])

  useEffect(() => {
    if (!target || !resolved) return
    const title = localized(resolved.surface.title, resolved.surface.titleI18n, locale)
    document.title = title
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch((error) => {
        console.warn('[hiven] Failed to sync plugin surface window title:', error)
      })
  }, [target, resolved, locale])

  useEffect(() => {
    if (!target || !resolved?.surface.shell?.closeOnBlur) return
    const onBlur = () => {
      void hidePluginSurfaceWindow(target)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [target, resolved])

  if (!target) {
    return <PluginSurfaceWindowShell theme={theme} fontSize={fontSize}>Invalid plugin surface target</PluginSurfaceWindowShell>
  }

  if (!resolved) {
    return <PluginSurfaceWindowShell theme={theme} fontSize={fontSize}>Surface not found</PluginSurfaceWindowShell>
  }

  return (
    <PluginSurfaceWindowShell theme={theme} fontSize={fontSize}>
      <PluginSurfaceRenderer
        target={target}
        locale={locale}
        className="h-full"
        bodyClassName="h-full"
        showPermissionBack={false}
        onBack={() => { void hidePluginSurfaceWindow(target) }}
        onClose={() => { void hidePluginSurfaceWindow(target) }}
        onOpenSettings={() => {
          usePluginSettingsStore.getState().openSettingsDialog({
            pluginId: target.pluginId,
            source: target.source,
            presentation: 'dialog',
            context: { surfaceId: 'global-launcher' },
          })
        }}
      />
      <PluginSettingsDialog />
    </PluginSurfaceWindowShell>
  )
}

function PluginSurfaceWindowShell({
  theme,
  fontSize,
  children,
}: {
  theme: string
  fontSize: string
  children: ReactNode
}) {
  return (
    <div className="flux-spatial-shell" data-theme={theme} style={{ fontSize, height: '100vh' }}>
      <main className="flux-content" style={{ height: '100vh', overflow: 'hidden' }}>
        {children}
      </main>
    </div>
  )
}

function readPluginSurfaceTargetFromLocation(): PluginSurfaceOpenTarget | null {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')
  const pluginId = params.get('pluginId')
  const surfaceId = params.get('surfaceId')
  if (
    (source !== 'builtin' && source !== 'installed' && source !== 'dev') ||
    !pluginId ||
    !surfaceId
  ) {
    return null
  }
  return { source, pluginId, surfaceId }
}
