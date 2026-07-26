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
}
