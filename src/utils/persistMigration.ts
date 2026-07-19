export function migrateStorageKey(storage: Storage, legacyKey: string, nextKey: string): void {
  if (storage.getItem(nextKey) !== null) return
  const legacyValue = storage.getItem(legacyKey)
  if (legacyValue !== null) {
    storage.setItem(nextKey, legacyValue)
  }
}

export function migrateLocalStorageKey(legacyKey: string, nextKey: string): void {
  if (typeof window === 'undefined') return
  try {
    migrateStorageKey(window.localStorage, legacyKey, nextKey)
  } catch {
    // Storage migration is best-effort; the stores still initialize with defaults.
  }
}
