/**
 * hiven Unified i18n System — Public API
 *
 * Auto-registers all system locale modules on first import.
 * Plugins are registered automatically by the plugin loading pipeline.
 *
 * Public exports:
 *   - useT(namespace?)        — React Hook (the primary API)
 *   - translate(locale, ns, key, vars?) — Non-React escape hatch
 *   - I18nNamespaceProvider   — Context provider (used by plugin hosts)
 *   - registerMessages / unregisterMessages — Internal, used by plugin loader
 *   - Locale                  — Type
 */

export type { Locale } from './registry'
export { translate, registerMessages, unregisterMessages, getMessages } from './registry'
export { useT, I18nNamespaceProvider, type TranslateFunction } from './context'

// ─── Auto-register system locale modules ──────────────────────────────────────
//
// Each file under ./locales/*.ts exports a default `{ en: {...}, zh: {...} }`.
// The filename (without extension) becomes the namespace.

import { registerMessages, type Messages } from './registry'

const localeModules = import.meta.glob('./locales/*.ts', {
  eager: true,
}) as Record<string, { default: Messages }>

for (const [path, mod] of Object.entries(localeModules)) {
  const match = path.match(/\.\/locales\/(.+)\.ts$/)
  if (match) {
    const namespace = match[1]
    registerMessages(namespace, mod.default)
  }
}

// ─── Legacy compat: old `t(locale, key)` for gradual migration ────────────────
//
// This bridges the old API where system keys were namespaced with a dot prefix
// (e.g., 'nav.editor'). It splits on the first dot to determine namespace + key.
// DEPRECATED: use useT(namespace) in components instead.

import type { Locale } from './registry'
import { translate } from './registry'

/**
 * @deprecated Use `useT(namespace)` hook or `translate(locale, namespace, key)` instead.
 * Bridges old `t(locale, 'namespace.key')` calls during migration.
 *
 * Strategy: split on first dot → namespace + key. If the namespace has the key,
 * return it. Otherwise fall back to trying the full dottedKey as a key in each
 * namespace (handles cases like workspace namespace having keys like 'renderer.notFound').
 */
export function t(locale: Locale, dottedKey: string, vars?: Record<string, string | number>): string {
  const dotIndex = dottedKey.indexOf('.')
  if (dotIndex === -1) {
    return translate(locale, dottedKey, dottedKey, vars)
  }
  const namespace = dottedKey.slice(0, dotIndex)
  const key = dottedKey.slice(dotIndex + 1)
  const result = translate(locale, namespace, key, vars)
  // If translate returned the raw key (miss), try looking up the full dottedKey
  // in all namespaces — this handles keys like 'status.active' in workspace ns
  // where the old code called t(locale, 'status.active').
  if (result === key) {
    // Try known system namespaces that have nested-dot keys
    const fallbackNamespaces = ['workspace', 'scripts', 'settings', 'update', 'editor', 'palette', 'pluginEditor', 'nav']
    for (const ns of fallbackNamespaces) {
      if (ns === namespace) continue
      const fallback = translate(locale, ns, dottedKey, vars)
      if (fallback !== dottedKey) return fallback
    }
  }
  return result
}

// ─── Legacy compat: MessageKey type (union of all system keys) ────────────────
// Kept for backward-compat during migration. Will be removed once all consumers
// use useT().

export type MessageKey = string
