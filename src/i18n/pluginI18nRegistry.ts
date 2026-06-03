/**
 * Plugin i18n registry.
 * Plugins ship locale dictionaries under `locales/{en,zh}.json`. The host
 * registers them per pluginId namespace. The injected `i18n.t(key)` resolves
 * with a three-level fallback:
 *   1. plugin namespace messages (current locale, then en)
 *   2. host global dictionary (via hostT)
 *   3. raw key
 */

import type { Locale } from './index'
import { t as hostT, type MessageKey } from './index'

export type PluginMessages = Partial<Record<Locale, Record<string, string>>>

const registry = new Map<string, PluginMessages>()

export function registerPluginMessages(pluginId: string, messages: PluginMessages): void {
  registry.set(pluginId, messages)
}

export function unregisterPluginMessages(pluginId: string): void {
  registry.delete(pluginId)
}

export function clearPluginMessages(): void {
  registry.clear()
}

function applyVars(value: string, vars?: Record<string, string | number>): string {
  if (!vars) return value
  let out = value
  for (const [name, replacement] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(replacement))
  }
  return out
}

export type PluginT = (key: string, vars?: Record<string, string | number>) => string

/**
 * Build a translate function bound to a plugin namespace and locale.
 * Plugin code only writes short keys; resolution falls back to host dict then key.
 */
export function makePluginT(pluginId: string, locale: Locale): PluginT {
  return (key, vars) => {
    const messages = registry.get(pluginId)
    const localized = messages?.[locale]?.[key] ?? messages?.en?.[key]
    if (localized != null) return applyVars(localized, vars)
    // Fallback to host global dictionary, then raw key (hostT already returns key on miss).
    return hostT(locale, key as MessageKey, vars)
  }
}
