/**
 * Per-app global hotkeys (Tinycast-style focus/hide toggle).
 * Pure helpers + persistence shape; registration lives in src/hotkeys/appHotkeys.ts.
 */

export type AppHotkeyBinding = {
  /** Stable installed-app id (e.g. macos:bundle:com.apple.Safari). */
  appId: string
  /** Display name for settings list. */
  name: string
  /** Tauri global-shortcut accelerator, e.g. Cmd+Shift+S */
  accelerator: string
  enabled?: boolean
}

export const APP_HOTKEYS_MAX = 24

export function emptyAppHotkeys(): AppHotkeyBinding[] {
  return []
}

export function normalizeAppHotkeys(raw: unknown): AppHotkeyBinding[] {
  if (!Array.isArray(raw)) return []
  const out: AppHotkeyBinding[] = []
  const seenAcc = new Set<string>()
  const seenApp = new Set<string>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Partial<AppHotkeyBinding>
    const appId = typeof r.appId === 'string' ? r.appId.trim() : ''
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const accelerator = typeof r.accelerator === 'string' ? r.accelerator.trim() : ''
    if (!appId || !accelerator) continue
    const accKey = accelerator.toLowerCase()
    if (seenAcc.has(accKey) || seenApp.has(appId)) continue
    seenAcc.add(accKey)
    seenApp.add(appId)
    out.push({
      appId,
      name: name || appId,
      accelerator,
      enabled: r.enabled !== false,
    })
    if (out.length >= APP_HOTKEYS_MAX) break
  }
  return out
}

export function upsertAppHotkey(
  list: readonly AppHotkeyBinding[],
  binding: AppHotkeyBinding,
): AppHotkeyBinding[] {
  const next = normalizeAppHotkeys([
    binding,
    ...list.filter((b) => b.appId !== binding.appId && b.accelerator !== binding.accelerator),
  ])
  return next
}

export function removeAppHotkey(
  list: readonly AppHotkeyBinding[],
  appId: string,
): AppHotkeyBinding[] {
  return list.filter((b) => b.appId !== appId)
}
