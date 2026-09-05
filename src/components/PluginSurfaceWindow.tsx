import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type PluginSurfaceOpenTarget } from '../store'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'
import { pluginSurfaceInstanceId, pluginSurfaceWindowLabel } from '../workspace/pluginSurfaceWindows'
import { hideCurrentPluginSurfaceWindow, hidePluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { useT } from '../i18n'
import { PluginSettingsDialog } from './PluginSettingsDialog'
import { ToastContainer } from './workspace/ToastContainer'
import { PluginSurfaceRenderer, usePluginSurfaceRendersTitlebar, usePluginSurfaceTitle } from './pluginSurface/PluginSurfaceRenderer'
import './PluginSurfaceWindow.css'

export function PluginSurfaceWindow() {
  const locale = useAppStore((s) => s.locale)
  const theme = useAppStore((s) => s.settings.theme)
  const t = useT('workspace')
  const baseTarget = useMemo(() => parseTargetFromUrl(), [])
  const [target, setTarget] = useState<PluginSurfaceOpenTarget | null>(null)
  const [targetReady, setTargetReady] = useState(false)
  const title = usePluginSurfaceTitle(target, locale)
  const usesPluginTitlebar = usePluginSurfaceRendersTitlebar(target)

  useEffect(() => {
    if (!baseTarget) {
      setTargetReady(true)
      return
    }
    consumePluginSurfacePayload(baseTarget).then((resolved) => {
      setTarget(resolved)
      setTargetReady(true)
    })
  }, [baseTarget])

  useEffect(() => {
    if (!target) return
    const instanceId = pluginSurfaceInstanceId(target)
    upsertSurfaceInstance({
      id: instanceId,
      kind: 'plugin-surface',
      windowLabel: pluginSurfaceWindowLabel(target),
      title: title || target.surfaceId,
      pluginId: target.pluginId,
      surfaceId: target.surfaceId,
      state: 'visible',
      canReceiveText: true,
      canProvideText: true,
      canAttachToEditor: true,
    })
    const onPageHide = () => markSurfaceInstanceState(instanceId, 'destroyed')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      markSurfaceInstanceState(instanceId, 'hidden')
    }
  }, [target, title])

  const isImeComposingRef = useRef(false)

  useEffect(() => {
    const onCompositionStart = () => { isImeComposingRef.current = true }
    const onCompositionEnd = () => { isImeComposingRef.current = false }
    document.addEventListener('compositionstart', onCompositionStart)
    document.addEventListener('compositionend', onCompositionEnd)
    return () => {
      document.removeEventListener('compositionstart', onCompositionStart)
      document.removeEventListener('compositionend', onCompositionEnd)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isImeComposingRef.current || event.isComposing || (event as unknown as { keyCode: number }).keyCode === 229) return
      event.preventDefault()
      event.stopPropagation()
      void hideCurrentWindow(target)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [target])

  if (!targetReady) {
    return null
  }

  if (!target) {
    return <WindowMessage title={t('invalidTarget')} />
  }

  return (
    <div className="flux-spatial-shell plugin-surface-window-shell" data-theme={theme}>
      <div className="plugin-surface-window-frame">
        {!usesPluginTitlebar && (
          <div className="plugin-surface-window-titlebar" data-tauri-drag-region>
            <div className="plugin-surface-window-title" data-tauri-drag-region>{title || t('pluginSurface')}</div>
            <button className="plugin-surface-window-close" type="button" onClick={() => { void hideCurrentWindow(target) }}>×</button>
          </div>
        )}
        <div className="plugin-surface-window-body">
          <PluginSurfaceRenderer
            target={target}
            locale={locale}
            presentation="plugin-surface-window"
            contextSurfaceId="plugin-surface-window"
            onBack={() => { void hideCurrentWindow(target) }}
            onClose={() => { void hideCurrentWindow(target) }}
          />
        </div>
      </div>
      <PluginSettingsDialog />
      <ToastContainer />
    </div>
  )
}

function parseTargetFromUrl(): PluginSurfaceOpenTarget | null {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')
  const pluginId = params.get('pluginId')
  const surfaceId = params.get('surfaceId')
  if (!isPluginSettingsSource(source) || !pluginId || !surfaceId) return null
  return { source, pluginId, surfaceId }
}

function isPluginSettingsSource(value: string | null): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function hideCurrentWindow(target?: PluginSurfaceOpenTarget | null): Promise<void> {
  if (isTauriRuntime()) {
    if (target) {
      await hidePluginSurfaceWindow(target).catch(() => undefined)
      return
    }
    await hideCurrentPluginSurfaceWindow().catch(() => undefined)
    return
  }
  window.close()
}

function WindowMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flux-spatial-shell plugin-surface-window-shell">
      <div className="plugin-surface-window-frame">
        <div className="plugin-surface-window-titlebar" data-tauri-drag-region>
          <div className="plugin-surface-window-title" data-tauri-drag-region>{title}</div>
          <button className="plugin-surface-window-close" type="button" onClick={() => { void hideCurrentWindow() }}>×</button>
        </div>
        <div className="plugin-surface-window-message">
          <div>{title}</div>
          {message && <small>{message}</small>}
        </div>
      </div>
    </div>
  )
}

async function consumePluginSurfacePayload(
  target: PluginSurfaceOpenTarget,
): Promise<PluginSurfaceOpenTarget> {
  if (!isTauriRuntime()) return target
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const label = pluginSurfaceWindowLabel(target)
    const payload = await invoke<{ initialText?: string } | null>(
      'plugin_surface_payload_consume',
      { label },
    )
    if (payload?.initialText) {
      return { ...target, initialText: payload.initialText }
    }
  } catch {
    // ignore — payload may not exist
  }
  return target
}
