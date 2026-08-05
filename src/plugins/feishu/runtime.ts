/**
 * Module-level binding of shell / settings / openUrl for provider + tools.
 * Host injects these on hooks.startup and settings.onChange.
 */

import type { LarkCliShell } from './cli/run'
import type { FeishuSettings } from './settings/model'
import { DEFAULT_FEISHU_SETTINGS } from './settings/model'
import {
  registerFeishuChatsProvider,
  unregisterFeishuChatsProvider,
} from './provider/chatsTargetProvider'
import {
  registerFeishuContactsProvider,
  unregisterFeishuContactsProvider,
} from './provider/contactsTargetProvider'
import {
  registerFeishuDocsProvider,
  unregisterFeishuDocsProvider,
} from './provider/docsTargetProvider'
import { listRecentChats, mapChatsToRows } from './domains/im'
import { rememberL1Entities } from './search/l1Cache'

export type FeishuRuntime = {
  shell: LarkCliShell | null
  settings: FeishuSettings
  openUrl: ((url: string) => Promise<void>) | null
  t: ((key: string, vars?: Record<string, string | number>) => string) | null
}

let runtime: FeishuRuntime = {
  shell: null,
  settings: { ...DEFAULT_FEISHU_SETTINGS },
  openUrl: null,
  t: null,
}

let warmStarted = false

export function bindFeishuRuntime(partial: {
  shell?: LarkCliShell | null
  settings?: FeishuSettings
  openUrl?: ((url: string) => Promise<void>) | null
  t?: ((key: string, vars?: Record<string, string | number>) => string) | null
}): void {
  runtime = {
    shell: partial.shell !== undefined ? partial.shell : runtime.shell,
    settings: partial.settings
      ? { ...DEFAULT_FEISHU_SETTINGS, ...partial.settings }
      : runtime.settings,
    openUrl: partial.openUrl !== undefined ? partial.openUrl : runtime.openUrl,
    t: partial.t !== undefined ? partial.t : runtime.t,
  }
}

export function getFeishuRuntime(): FeishuRuntime {
  return runtime
}

/**
 * Register/unregister L1 Desktop Target providers based on settings.
 * Plugin enabled is required; each mix-in has its own switch.
 */
export function applyFeishuProviderRegistration(settings?: FeishuSettings): void {
  const s = settings ?? runtime.settings
  const pluginOn = s.enabled !== false

  if (pluginOn && s.docsMixEnabled !== false) registerFeishuDocsProvider()
  else unregisterFeishuDocsProvider()

  if (pluginOn && s.chatsMixEnabled !== false) registerFeishuChatsProvider()
  else unregisterFeishuChatsProvider()

  if (pluginOn && s.contactsMixEnabled !== false) registerFeishuContactsProvider()
  else unregisterFeishuContactsProvider()

  if (pluginOn) {
    void warmFeishuL1EntityIndex()
  }
}

/**
 * Prefetch recent chats into the L1 entity index so first launcher open can
 * match common session names without waiting for +chat-search.
 */
export async function warmFeishuL1EntityIndex(): Promise<void> {
  if (warmStarted) return
  const shell = runtime.shell
  const settings = runtime.settings
  if (!shell || settings.enabled === false) return
  if (settings.chatsMixEnabled === false) return
  warmStarted = true
  try {
    const result = await listRecentChats({
      shell,
      binaryPath: settings.binaryPath || undefined,
      timeoutMs: 5000,
    })
    if (!result.ok) return
    const rows = mapChatsToRows(result.chats).filter((row) => Boolean(row.openUrl))
    if (rows.length) rememberL1Entities('chats', rows)
  } catch {
    // warm is best-effort; allow retry next registration if still cold
    warmStarted = false
  }
}
