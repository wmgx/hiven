import type { PluginSettingsContribution } from '../workspace/pluginTypes'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'

/** Read-only conflict detection for an optional field confirmation, not a CAS. */
export function readSettingsConfirmationSnapshot(
  storage: Pick<Storage, 'getItem'>, source: PluginSettingsSource, pluginId: string,
  contribution: Pick<PluginSettingsContribution, 'version' | 'defaultValue' | 'migrate'>,
): { fingerprint: string; value: Record<string, unknown> } {
  const raw = storage.getItem('hiven-plugin-settings')
  const envelope = raw === null ? null : JSON.parse(raw)
  const settings = envelope?.state?.pluginSettings
  if (raw !== null && (!settings || typeof settings !== 'object' || Array.isArray(settings))) throw new Error('Invalid settings envelope')
  const records = settings?.[source]
  if (records != null && (typeof records !== 'object' || Array.isArray(records))) throw new Error('Invalid settings source')
  const record = records?.[pluginId]
  const fingerprint = JSON.stringify(record ?? null)
  let value = record == null ? contribution.defaultValue : record.value
  if (record != null) {
    if (typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid settings record')
    const version = record.version ?? 1
    const current = contribution.version ?? 1
    if (typeof version !== 'number' || version > current) throw new Error('Unsupported settings version')
    if (version < current && contribution.migrate) value = contribution.migrate(record.value, version)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings value')
  return { fingerprint, value: JSON.parse(JSON.stringify(value)) }
}
