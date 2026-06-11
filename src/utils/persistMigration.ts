export function migrateLocalStorageKey(legacyKey: string, nextKey: string): void {
  if (typeof window === 'undefined') return
  try {
    const storage = window.localStorage
    if (storage.getItem(nextKey) !== null) return
    const legacyValue = storage.getItem(legacyKey)
    if (legacyValue !== null) {
      storage.setItem(nextKey, legacyValue)
    }
  } catch {
    // Storage migration is best-effort; the stores still initialize with defaults.
  }
}

