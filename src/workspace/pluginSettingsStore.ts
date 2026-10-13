/**
 * hiven Plugin System - Plugin Settings Store
 * Zustand store for plugin settings persistence.
 * Settings are isolated by source + pluginId.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LauncherHostId } from './launcher/types'

const PLUGIN_SETTINGS_KEY = 'hiven-plugin-settings'
const LEGACY_SETTINGS_KEY = 'fluxtext-plugin-settings'
const SETTINGS_LOCK = 'hiven:plugin-settings:write'

export type PluginSettingsCommitOptions = {
  expected?: PluginSettingsRecord | null
  isCurrent?: () => boolean
  validate?: (current: PluginSettingsRecord | undefined) => void
}

export class PluginSettingsCommitError extends Error {
  readonly code: 'conflict' | 'cancelled' | 'unavailable'
  constructor(code: 'conflict' | 'cancelled' | 'unavailable') { super(code); this.code = code }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PluginSettingsSource = 'builtin' | 'installed' | 'dev'

/** Static schema identity only; never a setting value or an instruction to run. */
export type PluginSettingsFieldTarget = {
  sectionId: string
  fieldKey: string
}

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
  target?: PluginSettingsFieldTarget
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

  /** Commit under the cross-window lock; publish only after durable persistence */
  setPluginSettings: (source: PluginSettingsSource, pluginId: string, value: unknown, version: number, options?: PluginSettingsCommitOptions) => Promise<void>

  /** Remove plugin settings */
  removePluginSettings: (source: PluginSettingsSource, pluginId: string) => Promise<void>

  /** Open settings dialog */
  openSettingsDialog: (target: NonNullable<PluginSettingsDialogTarget>) => void

  /** Close settings dialog */
  closeSettingsDialog: () => void
}

// ─── Store Implementation ────────────────────────────────────────────────────

const sources = ['builtin', 'installed', 'dev'] as const
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

/** Read-only legacy fallback; every actual write remains under the same lock. */
function readSettingsEnvelope() {
  const raw = window.localStorage.getItem(PLUGIN_SETTINGS_KEY) ?? window.localStorage.getItem(LEGACY_SETTINGS_KEY)
  return raw === null ? null : JSON.parse(raw)
}

export const usePluginSettingsStore = create<PluginSettingsStoreState>()(
  persist(
    (set, get) => {
      const publish = (settings: PluginSettingsStore) => set({ pluginSettings: reconcileSettings(get().pluginSettings, settings) })
      const writeRecord = async (source: PluginSettingsSource, pluginId: string, attempted: PluginSettingsRecord | undefined, options: PluginSettingsCommitOptions = {}) => {
        const expected = structuredClone(options.expected === undefined ? get().pluginSettings[source][pluginId] ?? null : options.expected)
        const record = attempted === undefined ? undefined : structuredClone(attempted)
        if (!globalThis.navigator?.locks?.request) throw new PluginSettingsCommitError('unavailable')
        await navigator.locks.request(SETTINGS_LOCK, () => {
          if (options.isCurrent?.() === false) throw new PluginSettingsCommitError('cancelled')
          const envelope = readSettingsEnvelope()
          const latest = persistedSettings(envelope?.state)
          if (!sameRecord(latest[source][pluginId], expected ?? undefined)) {
            publish(latest)
            throw new PluginSettingsCommitError('conflict')
          }
          options.validate?.(latest[source][pluginId])
          if (options.isCurrent?.() === false) throw new PluginSettingsCommitError('cancelled')
          const next = { ...latest, [source]: { ...latest[source] } }
          if (record === undefined) delete next[source][pluginId]
          else next[source][pluginId] = record
          // No await between validation and durable commit. Never notify a
          // background about a candidate that failed to persist.
          window.localStorage.setItem(PLUGIN_SETTINGS_KEY, JSON.stringify({ ...envelope, state: { ...envelope?.state, pluginSettings: next }, version: envelope?.version ?? 0 }))
          publish(next)
        })
      }
      return {
        pluginSettings: { builtin: {}, installed: {}, dev: {} },
        settingsDialogTarget: null,
        getPluginSettings: (source, pluginId) => get().pluginSettings[source][pluginId],
        setPluginSettings: (source, pluginId, value, version, options) => writeRecord(source, pluginId, { version, value }, options),
        removePluginSettings: (source, pluginId) => writeRecord(source, pluginId, undefined),
        openSettingsDialog: (target) => {
          publish(persistedSettings(readSettingsEnvelope()?.state))
          set({ settingsDialogTarget: target })
        },
        closeSettingsDialog: () => set({ settingsDialogTarget: null }),
      }
    },
    {
      name: PLUGIN_SETTINGS_KEY,
      // Zustand owns hydration only. Transient UI changes must never create
      // hidden writers outside the cross-window commit lock.
      storage: { getItem: () => readSettingsEnvelope(), setItem() {}, removeItem() {} },
      partialize: (state) => ({ pluginSettings: state.pluginSettings }),
      merge: (persisted, current) => ({ ...current, pluginSettings: reconcileSettings(current.pluginSettings, persistedSettings(persisted)) }),
    },
  ),
)

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== PLUGIN_SETTINGS_KEY && event.key !== LEGACY_SETTINGS_KEY && event.key !== null) return
    if (event.storageArea !== window.localStorage) return
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
      // Pure display projection. Backgrounds must await committed migration.
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

/** Background startup may not apply a migration before it is durably saved. */
export async function ensureCommittedPluginSettings<T>(source: PluginSettingsSource, pluginId: string,
  contribution: { version?: number; defaultValue: T; migrate?: (stored: unknown, fromVersion: number) => T }, isCurrent: () => boolean): Promise<T> {
  const record = usePluginSettingsStore.getState().getPluginSettings(source, pluginId)
  const resolved = resolvePluginSettings(source, pluginId, contribution)
  if (resolved.migrationError) throw new Error(resolved.migrationError)
  if (record && (record.version ?? 1) < (contribution.version ?? 1) && contribution.migrate) {
    await usePluginSettingsStore.getState().setPluginSettings(source, pluginId, resolved.value, contribution.version ?? 1, { expected: record, isCurrent })
  }
  if (!isCurrent()) throw new PluginSettingsCommitError('cancelled')
  return resolvePluginSettings(source, pluginId, contribution).value
}
