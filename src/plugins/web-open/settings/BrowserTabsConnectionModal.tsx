/**
 * Settings modal: Chromium bridge connection status + browsing-history / idle
 * toggles + extension install guide. Merged into web-open; reads/writes the
 * nested `browser` settings. All copy goes through the plugin locale (t) — no
 * inline locale branches.
 *
 * Sectioned into cards with a custom toggle switch (the shared `ui.Checkbox`
 * primitive is a bare native `<input type="checkbox">` with no styling — this
 * modal builds its own tactile switch locally rather than changing the shared
 * primitive, which would ripple into every other plugin's settings page).
 * Colors/radius/shadow all reference the app's real CSS custom properties
 * (--text-2, --border-subtle, --accent-soft, …) so light/dark both track the
 * app's existing theme automatically — no new palette introduced.
 */

import type { PluginSettingsModalBodyProps } from '@hiven/plugin'
import { getPluginHostSdk } from '@hiven/plugin'
import type { ReactNode } from 'react'
import {
  IDLE_TIMEOUT_PRESET_MINUTES,
  clampIdleTimeoutMinutes,
  idleTimeoutPresetKey,
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

// ─── local, tactile-styled primitives (scoped to this modal) ──────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      style={{
        flex: 'none',
        width: 34,
        height: 20,
        borderRadius: 999,
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        background: on ? 'var(--accent)' : 'var(--bg-surface-3, var(--text-3))',
        boxShadow: on ? 'none' : 'inset 0 1px 2px rgba(0,0,0,.05)',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        transition: 'background .18s ease, border-color .18s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1.5,
          left: on ? 15 : 1.5,
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.18), 0 0 0 0.5px rgba(0,0,0,.04)',
          transition: 'left .18s ease',
        }}
      />
    </button>
  )
}

function StatusChip({ label, tone }: { label: string; tone: 'on' | 'off' | 'muted' }) {
  const color = tone === 'on' ? 'var(--color-success, #3d9a5f)' : tone === 'off' ? 'var(--text-2)' : 'var(--text-3)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 9px 4px 7px',
        borderRadius: 999,
        background: tone === 'on' ? 'var(--accent-soft)' : 'var(--bg-surface-2, transparent)',
        border: `1px solid ${tone === 'on' ? 'var(--accent-border-soft, var(--border-subtle))' : 'var(--border-subtle)'}`,
        fontSize: 11.5,
        fontWeight: 500,
        color,
        width: 'fit-content',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: 'none' }} />
      {label}
    </span>
  )
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        padding: '13px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
      }}
    >
      {children}
    </div>
  )
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

  const connected = value.enabled && Boolean(bridge?.fresh)
  const statusTone: 'on' | 'off' | 'muted' = !value.enabled ? 'muted' : connected ? 'on' : 'off'
  const statusLabel = (() => {
    if (!value.enabled) return t('settings.disabled')
    if (!bridge) return t('settings.desktopUnavailable')
    if (!bridge.running) return t('settings.bridgeDown')
    if (!bridge.fresh) return t('settings.waiting')
    return t('settings.connectedShort') // e.g. "已连接"
  })()
  const statusDetail =
    value.enabled && bridge?.fresh
      ? t('settings.connectedDetail', { tabs: bridge.targetCount, history: bridge.historyCount, port: bridge.port })
      : null

  return (
    <ui.Stack gap={10}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <ui.Text style={{ fontSize: 12.5, fontWeight: 600 }}>{t('settings.connection')}</ui.Text>
          <StatusChip label={statusLabel} tone={statusTone} />
        </div>
        {statusDetail && (
          <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{statusDetail}</ui.Text>
        )}
        <ui.Button
          type="button"
          style={{ alignSelf: 'flex-start', marginTop: 2 }}
          onClick={() => {
            void refresh()
          }}
        >
          {t('settings.refresh')}
        </ui.Button>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <ui.Text style={{ fontSize: 12.5, fontWeight: 600 }}>{t('settings.history')}</ui.Text>
            <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {t('settings.historyHelp')}
            </ui.Text>
          </div>
          <Toggle
            on={value.historyEnabled !== false}
            onToggle={() => setValue({ ...value, historyEnabled: !value.historyEnabled })}
          />
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <ui.Text style={{ fontSize: 12.5, fontWeight: 600 }}>{t('settings.idle')}</ui.Text>
            <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {t('settings.idleHelp')}
            </ui.Text>
          </div>
          <Toggle
            on={value.autoCloseIdleTabs === true}
            onToggle={() => setValue({ ...value, autoCloseIdleTabs: !value.autoCloseIdleTabs })}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 2 }}>
          <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{t('settings.idleTimeout')}</ui.Text>
          <ui.Select
            disabled={value.autoCloseIdleTabs !== true}
            value={String(clampIdleTimeoutMinutes(value.idleTimeoutMinutes))}
            options={(() => {
              const current = clampIdleTimeoutMinutes(value.idleTimeoutMinutes)
              const options = IDLE_TIMEOUT_PRESET_MINUTES.map((minutes) => ({
                value: String(minutes),
                label: t(`settings.idleTimeout.${idleTimeoutPresetKey(minutes)}`),
              }))
              if (!(IDLE_TIMEOUT_PRESET_MINUTES as readonly number[]).includes(current)) {
                return [
                  ...options,
                  { value: String(current), label: t('settings.idleTimeout.custom', { minutes: current }) },
                ]
              }
              return options
            })()}
            onChange={(event: { target: { value: string } }) => {
              setValue({ ...value, idleTimeoutMinutes: clampIdleTimeoutMinutes(event.target.value) })
            }}
          />
        </label>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <ui.Text style={{ fontSize: 12.5, fontWeight: 600 }}>{t('settings.enableSearch')}</ui.Text>
            <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
              {t('settings.enableSearchHelp')}
            </ui.Text>
          </div>
          <Toggle on={value.enabled} onToggle={() => setValue({ ...value, enabled: !value.enabled })} />
        </div>
      </Card>

      <ui.Stack gap={8} style={{ marginTop: 4 }}>
        <ui.Text style={{ fontSize: 12.5, fontWeight: 600 }}>{t('settings.install')}</ui.Text>
        <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {t('settings.installHelp')}
        </ui.Text>
        <ui.Text style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>
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
