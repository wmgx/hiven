/**
 * Settings modal: Chromium bridge connection status + browsing-history / idle
 * toggles + extension install guide. Merged into web-open; reads/writes the
 * nested `browser` settings. All copy goes through the plugin locale (t) — no
 * inline locale branches.
 */

import type { PluginSettingsModalBodyProps } from '@hiven/plugin'
import { getPluginHostSdk } from '@hiven/plugin'
import {
  MAX_IDLE_TIMEOUT_MINUTES,
  MIN_IDLE_TIMEOUT_MINUTES,
  clampIdleTimeoutMinutes,
  normalizeBrowserTabsSettings,
  type BrowserTabsSettings,
} from '../browserTabsModel'
import type { WebQuickOpenSettings } from './model'

type BridgeLine = {
  running: boolean
  fresh: boolean
  targetCount: number
  historyCount: number
  port: number
}

export function BrowserTabsConnectionModal(props: PluginSettingsModalBodyProps<WebQuickOpenSettings>) {
  const { value: root, setValue: setRoot, t } = props
  // The merged plugin nests browser settings under `browser`; read/write there.
  const value = normalizeBrowserTabsSettings(root.browser)
  const setValue = (next: BrowserTabsSettings) => setRoot({ ...root, browser: next })
  const sdk = getPluginHostSdk()
  const React = sdk.react
  const { ui } = sdk
  const { useEffect, useState, useCallback } = React

  const [bridge, setBridge] = useState<BridgeLine | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastPath, setLastPath] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const status = await sdk.desktopTargets.bridge.status()
      if (!status) {
        setBridge(null)
        return
      }
      const src = status.sources.find((s) => s.sourceId === 'browser.chromium')
      setBridge({
        running: status.running,
        fresh: Boolean(src?.fresh),
        targetCount: src?.targetCount ?? 0,
        historyCount: src?.historyCount ?? 0,
        port: status.port,
      })
    } catch {
      setBridge(null)
    }
  }, [sdk])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const statusLabel = (() => {
    if (!value.enabled) return t('settings.disabled')
    if (!bridge) return t('settings.desktopUnavailable')
    if (!bridge.running) return t('settings.bridgeDown')
    if (!bridge.fresh) return t('settings.waiting')
    return t('settings.connected', {
      tabs: bridge.targetCount,
      history: bridge.historyCount,
      port: bridge.port,
    })
  })()

  const statusColor = !value.enabled
    ? 'var(--text-3)'
    : bridge?.fresh
      ? 'var(--color-success, #3d9a5f)'
      : 'var(--text-2)'

  return (
    <ui.Stack gap={14}>
      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.connection')}</ui.Text>
        <ui.Text style={{ fontSize: 12, color: statusColor }}>{statusLabel}</ui.Text>
        <ui.Button
          type="button"
          onClick={() => {
            void refresh()
          }}
        >
          {t('settings.refresh')}
        </ui.Button>
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.history')}</ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('settings.historyHelp')}</ui.Text>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.historyEnabled !== false}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, historyEnabled: event.target.checked })
            }}
          />
          {t('settings.historyToggle')}
        </label>
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.idle')}</ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('settings.idleHelp')}</ui.Text>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.autoCloseIdleTabs === true}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, autoCloseIdleTabs: event.target.checked })
            }}
          />
          {t('settings.idleToggle')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Text style={{ fontSize: 12 }}>{t('settings.idleTimeout')}</ui.Text>
          <ui.TextInput
            type="number"
            min={MIN_IDLE_TIMEOUT_MINUTES}
            max={MAX_IDLE_TIMEOUT_MINUTES}
            step={5}
            disabled={value.autoCloseIdleTabs !== true}
            value={clampIdleTimeoutMinutes(value.idleTimeoutMinutes)}
            onChange={(event: { target: { value: string } }) => {
              setValue({ ...value, idleTimeoutMinutes: clampIdleTimeoutMinutes(event.target.value) })
            }}
            style={{ width: 88 }}
          />
        </label>
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.enableSearch')}</ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>{t('settings.enableSearchHelp')}</ui.Text>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.enabled}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, enabled: event.target.checked })
            }}
          />
          {t('settings.enableSearchToggle')}
        </label>
      </ui.Stack>

      <ui.Stack gap={8}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>{t('settings.install')}</ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {t('settings.installHelp')}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
          {t('settings.installSteps')}
        </ui.Text>
        <ui.Stack gap={8} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <ui.Button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setMessage(null)
              void sdk.desktopTargets
                .openChromiumExtensionInstallFolder()
                .then(({ path }) => {
                  setLastPath(path)
                  setMessage(t('settings.folderOpened'))
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : String(error))
                })
                .finally(() => setBusy(false))
            }}
          >
            {t('settings.openFolder')}
          </ui.Button>
          <ui.Button
            type="button"
            disabled={busy || !lastPath}
            onClick={() => {
              if (!lastPath) return
              void navigator.clipboard?.writeText(lastPath).then(
                () => setMessage(t('settings.pathCopied')),
                () => setMessage(t('settings.copyFailed')),
              )
            }}
          >
            {t('settings.copyPath')}
          </ui.Button>
        </ui.Stack>
        {lastPath && (
          <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', wordBreak: 'break-all' }}>
            {lastPath}
          </ui.Text>
        )}
        {message && <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>{message}</ui.Text>}
      </ui.Stack>

      <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
        {t('settings.footer')}
      </ui.Text>
    </ui.Stack>
  )
}
