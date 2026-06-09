/**
 * Unified i18n Registry.
 *
 * Single source of truth for all translation messages — both system modules
 * and plugins. Each namespace (module name or pluginId) owns a flat
 * Record<locale, Record<key, string>> dictionary.
 *
 * This module is internal. Public API is exposed via ./index.ts and ./context.tsx.
 */

export type Locale = 'zh' | 'en'

export type Messages = Partial<Record<Locale, Record<string, string>>>

const registry = new Map<string, Messages>()

/**
 * Register messages under a namespace. Merges with any existing messages
 * for the same namespace (useful for lazy-loaded chunks).
 */
export function registerMessages(namespace: string, messages: Messages): void {
  const existing = registry.get(namespace)
  if (!existing) {
    registry.set(namespace, messages)
    return
  }
  // Merge per-locale dictionaries
  for (const locale of Object.keys(messages) as Locale[]) {
    const dict = messages[locale]
    if (!dict) continue
    existing[locale] = { ...existing[locale], ...dict }
  }
}

/**
 * Unregister a namespace (e.g., when a plugin is disabled).
 */
export function unregisterMessages(namespace: string): void {
  registry.delete(namespace)
}

/**
 * Clear all registered messages. Primarily for testing.
 */
export function clearAllMessages(): void {
  registry.clear()
}

/**
 * Core translate function.
 * Resolves a key within a given namespace and locale.
 *
 * Fallback order:
 *   1. namespace[locale][key]
 *   2. namespace['en'][key]
 *   3. raw key
 */
export function translate(
  locale: Locale,
  namespace: string,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const messages = registry.get(namespace)
  let value: string = messages?.[locale]?.[key] ?? messages?.['en']?.[key] ?? key
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
  }
  return value
}

/**
 * Get the raw messages map for a namespace. Used internally by
 * contribution localization (localizeContributions).
 */
export function getMessages(namespace: string): Messages | undefined {
  return registry.get(namespace)
}
