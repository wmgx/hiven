/**
 * hiven Plugin System - Plugin Settings Store
 * Zustand store for plugin settings persistence.
 * Settings are isolated by source + pluginId.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { migrateLocalStorageKey } from '../utils/persistMigration'
import type { LauncherHostId } from './launcher/types'

const PLUGIN_SETTINGS_KEY = 'hiven-plugin-settings'
migrateLocalStorageKey('fluxtext-plugin-settings', PLUGIN_SETTINGS_KEY)

// ─── Types ───────────────────────────────────────────────────────────────────

export type PluginSettingsSource = 'builtin' | 'installed' | 'dev'

export type PluginSettingsRecord = {
  version: number
  value: unknown
}

export type PluginSettingsStore = {
  builtin: Record<string, PluginSettingsRecord>
  installed: Record<string, PluginSettingsRecord>
  dev: Record<string, PluginSettingsRecord>
}

export type PluginSettingsDialogTarget = {
  pluginId: string
  source: PluginSettingsSource
  presentation?: 'dialog' | 'global-launcher' | 'plugin-surface-window'
  context?: {
    surfaceId?: LauncherHostId
  }
} | null

// ─── Store Interface ─────────────────────────────────────────────────────────

interface PluginSettingsStoreState {
  /** Settings data isolated by source */
  pluginSettings: PluginSettingsStore

  /** Currently open settings dialog target */
  settingsDialogTarget: PluginSettingsDialogTarget

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Get resolved settings for a plugin (with migration and default fallback) */
  getPluginSettings: (source: PluginSettingsSource, pluginId: string) => PluginSettingsRecord | undefined

  /** Set plugin settings value (write-through, immediate persist) */
  setPluginSettings: (source: PluginSettingsSource, pluginId: string, value: unknown, version: number) => void

  /** Remove plugin settings */
  removePluginSettings: (source: PluginSettingsSource, pluginId: string) => void

  /** Open settings dialog */
  openSettingsDialog: (target: NonNullable<PluginSettingsDialogTarget>) => void

  /** Close settings dialog */
  closeSettingsDialog: () => void
}

// ─── Store Implementation ────────────────────────────────────────────────────

const sources = ['builtin', 'installed', 'dev'] as const
// A subscriber can save again before the outer persist write finishes.
const pendingWrites = new Map<PluginSettingsSource, Map<string, number>>()

function sameRecord(a: PluginSettingsRecord | undefined, b: PluginSettingsRecord | undefined): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** Keep unchanged identities so another plugin's save does not restart its background. */
function reconcileSettings(current: PluginSettingsStore, incoming: PluginSettingsStore): PluginSettingsStore {
  let result = current
  for (const source of sources) {
    const previous = current[source]
    const next = incoming[source]
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
    if ([...keys].every((key) => sameRecord(previous[key], next[key]))) continue
    if (result === current) result = { ...current }
    result[source] = Object.fromEntries(Object.entries(next).map(([key, record]) => [
      key, sameRecord(previous[key], record) ? previous[key] : record,
    ]))
  }
  return result
}

function persistedSettings(value: unknown): PluginSettingsStore {
  const settings = (value as { pluginSettings?: PluginSettingsStore } | null)?.pluginSettings
  return Object.fromEntries(sources.map((source) => {
    const records = settings?.[source]
    if (records != null && (typeof records !== 'object' || Array.isArray(records))) {
      throw new Error('Invalid persisted plugin settings')
    }
    return [source, records ?? {}]
  })) as PluginSettingsStore
}

/** Read at write time: a delayed storage event must not let this window overwrite another. */
function latestSettings(
  current: PluginSettingsStore,
  durableTarget?: { source: PluginSettingsSource; pluginId: string },
): PluginSettingsStore {
  if (typeof window === 'undefined') return current
  const raw = window.localStorage.getItem(PLUGIN_SETTINGS_KEY)
  const latest = persistedSettings(raw === null ? undefined : JSON.parse(raw).state)
  for (const [source, plugins] of pendingWrites) {
    latest[source] = { ...latest[source] }
    for (const pluginId of plugins.keys()) {
      if (durableTarget?.source === source && durableTarget.pluginId === pluginId) continue
      const record = current[source][pluginId]
      if (record === undefined) delete latest[source][pluginId]
      else latest[source][pluginId] = record
    }
  }
  return reconcileSettings(current, latest)
}

export const usePluginSettingsStore = create<PluginSettingsStoreState>()(
  persist(
    (set, get) => {
      const writeRecord = (source: PluginSettingsSource, pluginId: string, attemptedRecord: PluginSettingsRecord | undefined) => {
        const previousSettings = latestSettings(get().pluginSettings)
        const previousRecord = previousSettings[source][pluginId]
        const pending = pendingWrites.get(source) ?? new Map<string, number>()
        pendingWrites.set(source, pending)
        pending.set(pluginId, (pending.get(pluginId) ?? 0) + 1)
        try {
          const next = { ...previousSettings[source] }
          if (attemptedRecord === undefined) delete next[pluginId]
          else next[pluginId] = attemptedRecord
          set({ pluginSettings: { ...previousSettings, [source]: next } })
        } catch (error) {
          // Persist writes after notifying subscribers; a newer record must survive.
          if (get().pluginSettings[source][pluginId] === attemptedRecord) {
            try {
              set((state) => {
                let latest = state.pluginSettings
                let rollbackRecord = previousRecord
                try {
                  latest = latestSettings(latest, { source, pluginId })
                  const durableRecord = latest[source][pluginId]
                  // Another window may have saved this same record during notification.
                  if (!sameRecord(durableRecord, previousRecord) && !sameRecord(durableRecord, attemptedRecord)) {
                    rollbackRecord = durableRecord
                  }
                } catch {
                  // A read failure during persist must not prevent memory rollback.
                }
                const next = { ...latest[source] }
                if (rollbackRecord === undefined) delete next[pluginId]
                else next[pluginId] = rollbackRecord
                return { pluginSettings: { ...latest, [source]: next } }
              })
            } catch {
              // Memory is restored before a second persistence failure; keep the original error.
            }
          }
          throw error
        } finally {
          const depth = (pending.get(pluginId) ?? 1) - 1
          if (depth > 0) pending.set(pluginId, depth)
          else pending.delete(pluginId)
          if (pending.size === 0) pendingWrites.delete(source)
        }
      }
      return {
        pluginSettings: { builtin: {}, installed: {}, dev: {} },
        settingsDialogTarget: null,
        getPluginSettings: (source, pluginId) => get().pluginSettings[source][pluginId] ?? undefined,
        setPluginSettings: (source, pluginId, value, version) => writeRecord(source, pluginId, { version, value }),
        removePluginSettings: (source, pluginId) => writeRecord(source, pluginId, undefined),
        openSettingsDialog: (target) => set((state) => ({
          pluginSettings: latestSettings(state.pluginSettings),
          settingsDialogTarget: target,
        })),
        closeSettingsDialog: () => {
          try {
            set({ settingsDialogTarget: null })
          } catch (error) {
            // The transient target is already cleared before persist writes.
            console.warn('[hiven] Could not persist plugin settings dismissal:', error)
          }
        },
      }
    },
    {
      name: PLUGIN_SETTINGS_KEY,
      // Transient dialog changes must not write this window's stale settings back.
      partialize: (state) => ({ pluginSettings: latestSettings(state.pluginSettings) }),
      merge: (persisted, current) => ({
        ...current,
        pluginSettings: reconcileSettings(current.pluginSettings, persistedSettings(persisted)),
      }),
    }
  )
)

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== PLUGIN_SETTINGS_KEY && event.key !== null) return
    if (event.storageArea !== window.localStorage) return
    // Read the current durable value, never event.newValue (events can be delayed).
    // Zustand rehydrate updates subscribers without persisting back or sharing dialog state.
    void usePluginSettingsStore.persist.rehydrate()
  })
}

// ─── Settings Resolution ─────────────────────────────────────────────────────

/**
 * Resolve plugin settings with migration and version handling.
 * Returns the resolved value or defaultValue on failure.
 */
export function resolvePluginSettings<TSettings>(
  source: PluginSettingsSource,
  pluginId: string,
  contribution: {
    version?: number
    defaultValue: TSettings
    migrate?: (stored: unknown, fromVersion: number) => TSettings
  }
): { value: TSettings; migrationError?: string } {
  const record = usePluginSettingsStore.getState().getPluginSettings(source, pluginId)
  const currentVersion = contribution.version ?? 1

  // No stored settings — use default
  if (!record) {
    return { value: contribution.defaultValue }
  }

  const storedVersion = record.version ?? 1

  // Same version — use stored value directly
  if (storedVersion === currentVersion) {
    return { value: record.value as TSettings }
  }

  // Downgrade (stored version > current) — fallback to default, keep stored data
  if (storedVersion > currentVersion) {
    return {
      value: contribution.defaultValue,
      migrationError: 'settings_version_higher_than_plugin',
    }
  }

  // Upgrade (stored version < current) — run migrate
  if (contribution.migrate) {
    try {
      const migrated = contribution.migrate(record.value, storedVersion)
      if (migrated == null) {
        return {
          value: contribution.defaultValue,
          migrationError: 'migration_returned_null',
        }
      }
      // Persist migrated value
      usePluginSettingsStore.getState().setPluginSettings(source, pluginId, migrated, currentVersion)
      return { value: migrated }
    } catch (error) {
      return {
        value: contribution.defaultValue,
        migrationError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // No migrate function — use stored value as-is (best effort)
  return { value: record.value as TSettings }
}
