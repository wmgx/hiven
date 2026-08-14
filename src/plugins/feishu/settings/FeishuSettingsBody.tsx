/**
 * Feishu settings: enable switches, binary path, CLI detect, auth login.
 */

import type { PluginSettingsBodyProps } from '@hiven/plugin'
import { getPluginHostSdk } from '@hiven/plugin'
import { detectLarkCli } from '../cli/detect'
import { completeLogin, getAuthStatus, startLogin } from '../domains/auth'
import { getFeishuRuntime } from '../runtime'
import type { FeishuSettings } from './model'

export function FeishuSettingsBody(props: PluginSettingsBodyProps<FeishuSettings>) {
  const { value, setValue, locale, t, openExternal } = props
  const sdk = getPluginHostSdk()
  const React = sdk.react
  const { ui } = sdk
  const { useCallback, useEffect, useState } = React

  const zh = (locale ?? '').toLowerCase().startsWith('zh')

  const [cliSummary, setCliSummary] = useState<string | null>(null)
  const [cliOk, setCliOk] = useState<boolean | null>(null)
  const [authSummary, setAuthSummary] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pendingDeviceCode, setPendingDeviceCode] = useState<string | undefined>()

  const label = (key: string, en: string, zhText: string) => {
    try {
      const translated = t(key)
      if (translated && translated !== key) return translated
    } catch {
      // ignore
    }
    return zh ? zhText : en
  }

  const refresh = useCallback(async () => {
    const runtime = getFeishuRuntime()
    const shell = runtime.shell
    if (!shell) {
      setCliOk(null)
      setCliSummary(zh ? 'Shell 未就绪（请授予 shell.run 权限）' : 'Shell unavailable (grant shell.run)')
      setAuthSummary(null)
      setLoggedIn(null)
      return
    }

    try {
      const detect = await detectLarkCli({
        shell,
        binaryPath: value.binaryPath || undefined,
      })
      setCliOk(detect.installed)
      setCliSummary(detect.summary ?? (detect.installed ? 'ok' : 'not installed'))

      if (!detect.installed) {
        setAuthSummary(null)
        setLoggedIn(null)
        return
      }

      const auth = await getAuthStatus(shell, value.binaryPath || undefined)
      setLoggedIn(auth.loggedIn)
      setAuthSummary(auth.summary)
    } catch (error) {
      setCliOk(false)
      setCliSummary(error instanceof Error ? error.message : String(error))
    }
  }, [value.binaryPath, zh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const statusColor =
    !value.enabled
      ? 'var(--text-3)'
      : cliOk && loggedIn
        ? 'var(--color-success, #3d9a5f)'
        : 'var(--text-2)'

  return (
    <ui.Stack gap={14}>
      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {label('settings.status', 'Status', '状态')}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: statusColor }}>
          {!value.enabled
            ? label('settings.disabled', 'Disabled', '已关闭')
            : [
                cliSummary
                  ? `${label('settings.cli', 'CLI', 'CLI')}: ${cliSummary}`
                  : label('settings.cliUnknown', 'CLI: unknown', 'CLI：未知'),
                authSummary
                  ? `${label('settings.auth', 'Auth', '登录')}: ${authSummary}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </ui.Text>
        <ui.Button
          type="button"
          disabled={busy}
          onClick={() => {
            setMessage(null)
            void refresh()
          }}
        >
          {label('settings.refresh', 'Refresh status', '刷新状态')}
        </ui.Button>
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {label('settings.enable', 'Enable Feishu', '启用飞书')}
        </ui.Text>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.enabled}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, enabled: event.target.checked })
            }}
          />
          {label('settings.enablePlugin', 'Enable Feishu plugin', '启用飞书插件')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.docsMixEnabled}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, docsMixEnabled: event.target.checked })
            }}
          />
          {label(
            'settings.enableDocsMix',
            'Show Feishu docs in Global Launcher',
            '在 Global Launcher 混排飞书文档',
          )}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.chatsMixEnabled !== false}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, chatsMixEnabled: event.target.checked })
            }}
          />
          {label(
            'settings.enableChatsMix',
            'Show Feishu chats in Global Launcher',
            '在 Global Launcher 混排飞书会话',
          )}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.contactsMixEnabled !== false}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, contactsMixEnabled: event.target.checked })
            }}
          />
          {label(
            'settings.enableContactsMix',
            'Show Feishu people in Global Launcher',
            '在 Global Launcher 混排飞书联系人',
          )}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.preferWindowFocus !== false}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, preferWindowFocus: event.target.checked })
            }}
          />
          {label(
            'settings.preferWindowFocus',
            'After open, try raising Feishu window (macOS)',
            '打开后尝试聚焦飞书窗口（macOS）',
          )}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.advancedToolsEnabled === true}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, advancedToolsEnabled: event.target.checked })
            }}
          />
          {label(
            'settings.advancedTools',
            'Show all Feishu commands',
            '显示全部飞书命令',
          )}
        </label>
        <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
          {label(
            'settings.advancedToolsHint',
            'Defaults to docs / chats / people / agenda search plus doc and sheet creation. Enable to surface messaging, minutes, tasks and the rest.',
            '默认保留搜文档 / 搜会话 / 找人 / 看日程 / 建文档 / 建表格。开启后会显示发消息、搜妙记、我的任务等全部命令。',
          )}
        </ui.Text>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.contactSearchOnlyChatted === true}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, contactSearchOnlyChatted: event.target.checked })
            }}
          />
          {label(
            'settings.contactSearchOnlyChatted',
            'Find People: only show contacts I have chatted with',
            '「找人」仅显示已聊过的联系人',
          )}
        </label>
        <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
          {label(
            'settings.contactSearchOnlyChattedHint',
            'Main launcher always hides strangers. This only affects the Find People tool.',
            '主 launcher 混排始终隐藏无交集的人；此项只影响「找人」命令。',
          )}
        </ui.Text>
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {label('settings.binaryPath', 'lark-cli path', 'lark-cli 路径')}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {label(
            'settings.binaryPathHint',
            'Leave empty to use `lark-cli` from PATH.',
            '留空则从 PATH 解析 `lark-cli`。',
          )}
        </ui.Text>
        <ui.TextInput
          value={value.binaryPath}
          placeholder="/usr/local/bin/lark-cli"
          onChange={(event: { target: { value: string } }) => {
            setValue({ ...value, binaryPath: event.target.value })
          }}
        />
      </ui.Stack>

      <ui.Stack gap={8}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {label('settings.login', 'Login', '登录')}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {label(
            'settings.loginHint',
            'Uses local lark-cli Device Flow / browser login. hiven never stores your token.',
            '通过本机 lark-cli 设备码 / 浏览器登录。hiven 不会保存你的 token。',
          )}
        </ui.Text>
        <ui.Stack gap={8} style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <ui.Button
            type="button"
            disabled={busy}
            onClick={() => {
              const runtime = getFeishuRuntime()
              if (!runtime.shell) {
                setMessage(
                  label(
                    'error.shellMissing',
                    'Shell permission required',
                    '需要 shell.run 权限',
                  ),
                )
                return
              }
              setBusy(true)
              setMessage(null)
              void startLogin(runtime.shell, value.binaryPath || undefined)
                .then(async (started) => {
                  if (!started.ok) {
                    setMessage(started.message ?? 'Login failed')
                    return
                  }
                  if (started.deviceCode) setPendingDeviceCode(started.deviceCode)
                  if (started.verificationUrl) {
                    try {
                      if (runtime.openUrl) await runtime.openUrl(started.verificationUrl)
                      else await openExternal(started.verificationUrl)
                    } catch {
                      // ignore open failures
                    }
                    setMessage(
                      label(
                        'settings.loginOpened',
                        'Opened verification URL — authorize, then click Complete login.',
                        '已打开验证链接，授权后点击「完成登录」。',
                      ),
                    )
                  } else {
                    setMessage(
                      started.message ||
                        label(
                          'settings.loginStarted',
                          'Login started. Complete authorization, then refresh status.',
                          '已发起登录，完成授权后请刷新状态。',
                        ),
                    )
                  }
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : String(error))
                })
                .finally(() => setBusy(false))
            }}
          >
            {label('settings.loginStart', 'Login with Feishu', '登录飞书')}
          </ui.Button>
          <ui.Button
            type="button"
            disabled={busy}
            onClick={() => {
              const runtime = getFeishuRuntime()
              if (!runtime.shell) {
                setMessage(
                  label(
                    'error.shellMissing',
                    'Shell permission required',
                    '需要 shell.run 权限',
                  ),
                )
                return
              }
              setBusy(true)
              setMessage(null)
              void completeLogin(runtime.shell, {
                binaryPath: value.binaryPath || undefined,
                deviceCode: pendingDeviceCode,
              })
                .then((done) => {
                  setMessage(
                    done.ok
                      ? done.message || label('settings.loginDone', 'Login completed', '登录完成')
                      : done.message || 'Login incomplete',
                  )
                  void refresh()
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : String(error))
                })
                .finally(() => setBusy(false))
            }}
          >
            {label('settings.loginComplete', 'Complete login', '完成登录')}
          </ui.Button>
          <ui.Button
            type="button"
            disabled={busy}
            onClick={() => {
              const runtime = getFeishuRuntime()
              if (!runtime.shell) {
                setMessage(
                  label(
                    'error.shellMissing',
                    'Shell permission required',
                    '需要 shell.run 权限',
                  ),
                )
                return
              }
              setBusy(true)
              setMessage(null)
              // Real avatars need contact.base; search alone has no avatar field.
              void startLogin(runtime.shell, value.binaryPath || undefined, undefined, [
                'contact:contact.base:readonly',
                'contact:user.base:readonly',
              ])
                .then(async (started) => {
                  if (!started.ok) {
                    setMessage(started.message ?? 'Avatar auth failed')
                    return
                  }
                  if (started.deviceCode) setPendingDeviceCode(started.deviceCode)
                  if (started.verificationUrl) {
                    try {
                      if (runtime.openUrl) await runtime.openUrl(started.verificationUrl)
                      else await openExternal(started.verificationUrl)
                    } catch {
                      // ignore
                    }
                    setMessage(
                      label(
                        'settings.avatarAuthOpened',
                        'Opened avatar permission URL — authorize, then click Complete login and search people again.',
                        '已打开头像权限授权页 — 授权后点「完成登录」，再搜一次联系人即可显示真头像。',
                      ),
                    )
                  } else {
                    setMessage(
                      started.message ||
                        label(
                          'settings.avatarAuthStarted',
                          'Avatar permission login started. Complete auth, then refresh.',
                          '已发起头像权限登录，完成后请刷新状态。',
                        ),
                    )
                  }
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : String(error))
                })
                .finally(() => setBusy(false))
            }}
          >
            {label('settings.avatarAuth', 'Authorize avatars', '授权显示头像')}
          </ui.Button>
        </ui.Stack>
        <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
          {label(
            'settings.avatarAuthHint',
            'Search returns no avatar field. Extra scope contact:contact.base:readonly is required for real profile photos.',
            '搜人接口本身不带头像；需额外授权 contact:contact.base:readonly 才能显示真实头像。',
          )}
        </ui.Text>
        {message && (
          <ui.Text style={{ fontSize: 12, color: 'var(--text-2)' }}>{message}</ui.Text>
        )}
      </ui.Stack>

      <ui.Stack gap={6}>
        <ui.Text style={{ fontSize: 13, fontWeight: 600 }}>
          {label('settings.recents', 'Recents', '最近推荐')}
        </ui.Text>
        <ui.Text style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {label(
            'settings.recentsHint',
            'Opened Feishu people / chats / docs can reappear in Global Launcher without searching again.',
            '打开过的飞书联系人 / 会话 / 文档会在 Global Launcher 里直接推荐，无需再搜。',
          )}
        </ui.Text>
        <ui.Button
          type="button"
          onClick={() => {
            try {
              // Host listens for this event (no plugin→store import).
              window.dispatchEvent(
                new CustomEvent('hiven:launcher-clear-persistable-recents'),
              )
              setMessage(
                label('settings.recentsCleared', 'Cleared recent recommendations', '已清除最近推荐'),
              )
            } catch {
              setMessage(
                label(
                  'settings.recentsClearFailed',
                  'Could not clear recents from this panel',
                  '无法在此清除最近推荐',
                ),
              )
            }
          }}
        >
          {label('settings.clearRecents', 'Clear recent recommendations', '清除最近推荐')}
        </ui.Button>
      </ui.Stack>

      <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
        {label(
          'settings.footer',
          'Empty search never lists Feishu docs. Install lark-cli and login to enable results.',
          '空搜索不会展示飞书文档。请安装 lark-cli 并登录后使用。',
        )}
      </ui.Text>
    </ui.Stack>
  )
}
