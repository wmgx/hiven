import { clearStandaloneLauncherBlurDevtoolsSuppress, suppressStandaloneLauncherBlurForDevtools } from '../launcherBlurGuard'
import type { LauncherItem } from './types'

/** The developer console is exposed only in debug builds. */
export function getDevtoolsHostItems(): LauncherItem[] {
  if (!import.meta.env.DEV) return []
  return [
    {
      systemKey: 'host:view:devtools',
      kind: 'host',
      display: {
        title: 'Open DevTools',
        titleI18n: { zh: '打开控制台' },
        subtitle: 'Open WebView developer tools for this window',
        subtitleI18n: { zh: '打开当前窗口的开发者工具（看日志）' },
        icon: 'Terminal',
        aliases: [
          'devtools',
          'dev tools',
          'console',
          'inspector',
          'debug console',
          'web inspector',
          '控制台',
          '开发者工具',
          '调试',
          '日志',
          '打开控制台',
          '打开调试',
        ],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher', 'quick-editor-command'],
      execute: async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          // DevTools opens as its own native panel outside the webview-window
          // registry — the blur-dismiss listener would otherwise see this as
          // "user left" and close the launcher out from under the console.
          suppressStandaloneLauncherBlurForDevtools()
          // Prefer the current window; fall back to launcher label.
          await invoke('open_devtools')
          return { ok: true, keepOpen: true }
        } catch (error) {
          clearStandaloneLauncherBlurDevtoolsSuppress()
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, message }
        }
      },
    },
  ]
}
