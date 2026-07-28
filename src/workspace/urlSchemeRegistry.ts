/**
 * Host-layer URL scheme allowlist for openUrl.
 *
 * Plugins register schemes they need (e.g. feishu → lark/feishu).
 * Host openExternalUrl routes:
 *   - built-in http(s)/mailto/tel → plugin-shell open (Tauri default scope)
 *   - plugin-registered schemes → open_system_url (native open, no Tauri shell scope change)
 *
 * Do not put product schemes into tauri.conf — keep interception above Tauri.
 */

const BUILTIN_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/** pluginId → schemes without trailing colon */
const schemesByPlugin = new Map<string, Set<string>>()

function normalizeScheme(scheme: string): string {
  return scheme.trim().toLowerCase().replace(/:$/, '')
}

export function registerUrlSchemes(pluginId: string, schemes: string[]): void {
  const id = pluginId.trim()
  if (!id) return
  const set = new Set<string>()
  for (const raw of schemes) {
    const s = normalizeScheme(raw)
    if (!s || BUILTIN_SCHEMES.has(s)) continue
    // Reject flag-like values
    if (/^[-/]/.test(s) || s.includes(' ')) continue
    set.add(s)
  }
  if (set.size === 0) {
    schemesByPlugin.delete(id)
    return
  }
  schemesByPlugin.set(id, set)
}

export function unregisterUrlSchemes(pluginId: string): void {
  schemesByPlugin.delete(pluginId.trim())
}

export function listRegisteredUrlSchemes(): string[] {
  const out = new Set<string>()
  for (const set of schemesByPlugin.values()) {
    for (const s of set) out.add(s)
  }
  return [...out].sort()
}

export function extractUrlScheme(url: string): string | null {
  const m = url.trim().match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
  return m ? normalizeScheme(m[1]) : null
}

export function isBuiltinOpenScheme(scheme: string): boolean {
  return BUILTIN_SCHEMES.has(normalizeScheme(scheme))
}

export function isRegisteredUrlScheme(scheme: string): boolean {
  const s = normalizeScheme(scheme)
  for (const set of schemesByPlugin.values()) {
    if (set.has(s)) return true
  }
  return false
}

/** True if host is allowed to open this URL (builtin or plugin-registered). */
export function canHostOpenUrl(url: string): boolean {
  const scheme = extractUrlScheme(url)
  if (!scheme) return false
  return isBuiltinOpenScheme(scheme) || isRegisteredUrlScheme(scheme)
}

export type UrlOpenRoute = 'shell-open' | 'system-url' | 'deny'

/**
 * Decide open path without touching Tauri shell scope.
 * - builtin schemes → try shell.open first
 * - plugin schemes → system open only
 */
export function routeHostOpenUrl(url: string): UrlOpenRoute {
  const scheme = extractUrlScheme(url)
  if (!scheme) return 'deny'
  if (isBuiltinOpenScheme(scheme)) return 'shell-open'
  if (isRegisteredUrlScheme(scheme)) return 'system-url'
  return 'deny'
}
