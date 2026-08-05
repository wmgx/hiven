/**
 * Settings body: connection status + install guide for the Chromium extension.
 */

import type { PluginSettingsBodyProps } from '@hiven/plugin'
import { getPluginHostSdk } from '@hiven/plugin'
import type { BrowserTabsSettings } from './model'

type BridgeLine = {
  running: boolean
  fresh: boolean
  targetCount: number
  port: number
}

export function BrowserTabsSettingsBody(props: PluginSettingsBodyProps<BrowserTabsSettings>) {
  const { value, setValue, locale } = props
  const sdk = getPluginHostSdk()
  const React = sdk.react
  const { ui } = sdk
  const { useEffect, useState, useCallback } = React

  const [bridge, setBridge] = useState<BridgeLine | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastPath, setLastPath] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const zh = locale === 'zh'

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
    if (!value.enabled) return zh ? '已关闭（不向 Launcher 注册）' : 'Disabled (not registered)'
    if (!bridge) return zh ? '桌面端未就绪' : 'Desktop runtime unavailable'
    if (!bridge.running) return zh ? '桥接未运行' : 'Bridge not running'
    if (!bridge.fresh) return zh ? '等待浏览器扩展连接…' : 'Waiting for browser extension…'
    return zh
      ? `已连接 · ${bridge.targetCount} 个标签 · 端口 ${bridge.port}`
      : `Connected · ${bridge.targetCount} tabs · port ${bridge.port}`
  })()

  const statusColor = !value.enabled
    ? 'var(--text-3)'
    : bridge?.fresh
      ? 'var(--color-success, #3d9a5f)'
      : 'var(--text-2)'

  return (
    <ui.Stack gap={14}>
      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {zh ? '连接状态' : 'Connection'}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: statusColor }}>{statusLabel}</ui.Text>
        <ui.Button
          type="button"
          onClick={() => {
            void refresh()
          }}
        >
          {zh ? '刷新状态' : 'Refresh status'}
        </ui.Button>
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {zh ? '启用标签搜索' : 'Enable tab search'}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {zh
            ? '开启后，本插件向 Host 注册 browser.chromium 目标源（与飞书等同一套 Desktop Target 协议）。'
            : 'When on, this plugin registers browser.chromium with the host (same Desktop Target protocol as future Feishu adapters).'}
        </ui.Text>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.enabled}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, enabled: event.target.checked })
            }}
          />
          {zh ? '向 Global Launcher 注册标签源' : 'Register tab source with Global Launcher'}
        </label>
      </ui.Stack>

      <ui.Stack gap={8}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {zh ? '安装浏览器扩展' : 'Install browser extension'}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {zh
            ? 'Chrome / Edge 不允许应用静默安装扩展。扩展在插件目录 plugins/builtin/browser-tabs/extension，请打开后「加载已解压的扩展程序」。'
            : 'Chrome / Edge block silent install. Package: plugins/builtin/browser-tabs/extension — open it and use Load unpacked.'}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55 }}>
          {zh ? (
            <>
              1. 点击「打开扩展目录」
              <br />
              2. 打开 Chrome / Edge → 扩展 → 开启开发者模式
              <br />
              3. 「加载已解压的扩展程序」→ 选择刚打开的文件夹
              <br />
              4. 回到此处刷新状态，应显示「已连接」
            </>
          ) : (
            <>
              1. Click “Open extension folder”
              <br />
              2. Chrome / Edge → Extensions → enable Developer mode
              <br />
              3. “Load unpacked” → select the folder that opened
              <br />
              4. Refresh status here — it should show Connected
            </>
          )}
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
                  setMessage(zh ? '已打开扩展目录' : 'Extension folder opened')
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : String(error))
                })
                .finally(() => setBusy(false))
            }}
          >
            {zh ? '打开扩展目录' : 'Open extension folder'}
          </ui.Button>
          <ui.Button
            type="button"
            disabled={busy || !lastPath}
            onClick={() => {
              if (!lastPath) return
              void navigator.clipboard?.writeText(lastPath).then(
                () => setMessage(zh ? '路径已复制' : 'Path copied'),
                () => setMessage(zh ? '复制失败' : 'Copy failed'),
              )
            }}
          >
            {zh ? '复制路径' : 'Copy path'}
          </ui.Button>
        </ui.Stack>
        {lastPath && (
          <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', wordBreak: 'break-all' }}>
            {lastPath}
          </ui.Text>
        )}
        {message && (
          <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>{message}</ui.Text>
        )}
      </ui.Stack>

      <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
        {zh
          ? '空搜索不会展示标签；输入标题或 URL 片段即可。断连时静默无结果，不打扰其它搜索。'
          : 'Empty search never lists tabs; type a title or URL fragment. When disconnected, results stay silent.'}
      </ui.Text>
    </ui.Stack>
  )
}
