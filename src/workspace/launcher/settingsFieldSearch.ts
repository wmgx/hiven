/** Explicit settings search reads declarations only, never resolved settings. */
import type { Locale } from '../../i18n'
import { translate } from '../../i18n'
import { pluginRegistry } from '../pluginRegistry'
import { getPluginPermissionSnapshot, missingPluginPermissions } from '../pluginPermissions'
import type { PluginPermission } from '../pluginTypes'
import { requestOpenLauncherPluginSettingsSurface } from '../launcherHostSurfaceBridge'
import { resolvePluginSettingsSource } from './pluginSource'
import { launcherHostHasCapability, normalizeLauncherSurfaceId, type LauncherItem, type LauncherSurfaceId } from './types'

type LocalizedText = Record<Locale, string>

export type SettingsFieldSearchEntry = {
  sectionId: string
  fieldKey: string
  label: LocalizedText
  description: LocalizedText
  pluginTitle: LocalizedText
  sectionTitle: LocalizedText
  sectionDescription: LocalizedText
  requires: PluginPermission[]
}

const FIELD_KINDS = new Set(['switch', 'number', 'select', 'text', 'textarea', 'list', 'object-list'])
const SETTINGS_FIELD_RESULT_LIMIT = 20

/** Require a separate prefix token and a nonempty term; ordinary search is untouched. */
export function parseSettingsFieldSearchQuery(query: string): string | null {
  const match = /^(?:settings|设置)\s+(.+)$/iu.exec(query.trim())
  return match ? match[1].trim().toLowerCase().replace(/\s+/g, ' ') || null : null
}

/** Ignore callbacks and accessors instead of invoking dynamic schema declarations. */
function staticValue(object: unknown, key: string): unknown {
  if (!object || typeof object !== 'object') return undefined
  return Object.getOwnPropertyDescriptor(object, key)?.value
}

function hasAccessor(object: unknown, key: string): boolean {
  if (!object || typeof object !== 'object') return false
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  return Boolean(descriptor && !('value' in descriptor))
}

/** Read array data without invoking an element getter or a custom iterator. */
function staticArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null
  const entries: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor && !('value' in descriptor)) return null
    if (descriptor) entries.push(descriptor.value)
  }
  return entries
}

function staticString(object: unknown, key: string): string {
  const value = staticValue(object, key)
  return typeof value === 'string' ? value : ''
}

function staticText(pluginId: string, object: unknown, key: string): LocalizedText {
  const base = staticString(object, key)
  const i18n = staticValue(object, `${key}I18n`)
  const text = (locale: Locale) => staticString(i18n, locale) || (base ? translate(locale, pluginId, base) : '')
  return { en: text('en'), zh: text('zh') }
}

/**
 * Whitelist the same top-level rows that the schema renderer can locate. Do not
 * traverse defaults, options, object-list children, custom bodies, or callbacks.
 */
export function indexPluginSettingsFields(definition: unknown, pluginId: string): SettingsFieldSearchEntry[] {
  const settings = staticValue(definition, 'settings')
  if (!settings || typeof settings !== 'object') return []
  const component = Object.getOwnPropertyDescriptor(settings, 'component')
  if (component && (!('value' in component) || component.value)) return []
  const sections = staticArray(staticValue(staticValue(settings, 'schema'), 'sections'))
  if (!sections) return []
  const pluginTitle = staticText(pluginId, settings, 'title')
  if (!pluginTitle.en) pluginTitle.en = pluginId
  if (!pluginTitle.zh) pluginTitle.zh = pluginTitle.en
  const entries: SettingsFieldSearchEntry[] = []
  const seen = new Set<string>()
  for (const section of sections) {
    const sectionId = staticString(section, 'id')
    const fields = staticArray(staticValue(section, 'fields'))
    if (!sectionId || !fields) continue
    const sectionTitle = staticText(pluginId, section, 'title')
    const sectionDescription = staticText(pluginId, section, 'description')
    for (const field of fields) {
      const kind = staticString(field, 'kind')
      const fieldKey = staticString(field, 'key')
      if (!FIELD_KINDS.has(kind) || !fieldKey || hasAccessor(field, 'disabled') || hasAccessor(field, 'requires') || staticValue(field, 'disabled')) continue
      // The renderer hides static selects with no meaningful choice. Only read
      // the length here; option labels/values and optionsFrom data are not indexed.
      if (kind === 'select' && hasAccessor(field, 'optionsFrom')) continue
      if (kind === 'select' && !staticValue(field, 'optionsFrom')) {
        const options = staticValue(field, 'options')
        if (!Array.isArray(options) || options.length <= 1) continue
      }
      const label = staticText(pluginId, field, 'label')
      if (!label.en && !label.zh) continue
      const identity = JSON.stringify([sectionId, fieldKey])
      if (seen.has(identity)) continue
      seen.add(identity)
      const rawRequires = staticValue(field, 'requires')
      const requires = rawRequires == null ? [] : staticArray(rawRequires)
      if (!requires || requires.some((permission) => typeof permission !== 'string')) continue
      entries.push({
        sectionId, fieldKey, label, pluginTitle, sectionTitle, sectionDescription,
        description: staticText(pluginId, field, 'description'),
        requires: requires as PluginPermission[],
      })
    }
  }
  return entries
}

function fieldMatches(entry: SettingsFieldSearchEntry, term: string): boolean {
  const text = [entry.label, entry.description, entry.pluginTitle, entry.sectionTitle, entry.sectionDescription]
    .flatMap((localized) => [localized.en, localized.zh])
    .map((value) => value.toLowerCase())
  return term.split(' ').every((token) => text.some((value) => value.includes(token)))
}

export function collectSettingsFieldSearchItems(query: string, surfaceId: LauncherSurfaceId): LauncherItem[] {
  const term = parseSettingsFieldSearchQuery(query)
  const hostId = normalizeLauncherSurfaceId(surfaceId)
  if (!term || hostId !== 'global-launcher' || !launcherHostHasCapability(hostId, 'settings')) return []
  const items: LauncherItem[] = []
  for (const { definition, pluginId, source } of pluginRegistry.getAllPluginDefinitions()) {
    const lifetime = pluginRegistry.getPluginLifetime(pluginId, source)
    if (!lifetime.active) continue
    const settingsSource = resolvePluginSettingsSource(pluginId, source)
    const availableFields = () => {
      if (!lifetime.active || pluginRegistry.getPluginDefinition(pluginId, source) !== definition) return []
      const requested = pluginRegistry.getPluginPermissions(pluginId, settingsSource)
      const snapshot = getPluginPermissionSnapshot(settingsSource, pluginId, requested)
      // Selection uses the plugin-wide permission gate before executing a host
      // row. Do not promise a direct field destination that would stop there.
      if (missingPluginPermissions(snapshot, requested).length > 0) return []
      return indexPluginSettingsFields(definition, pluginId)
        .filter((entry) => missingPluginPermissions(snapshot, entry.requires).length === 0)
    }
    for (const entry of availableFields()) {
      if (!fieldMatches(entry, term)) continue
      const subtitle = (locale: Locale) => [entry.pluginTitle[locale], entry.sectionTitle[locale]].filter(Boolean).join(' · ')
      items.push({
        systemKey: `settings-field:${settingsSource}:${encodeURIComponent(pluginId)}:${encodeURIComponent(entry.sectionId)}:${encodeURIComponent(entry.fieldKey)}`,
        kind: 'host',
        pluginId,
        pluginLifetime: lifetime,
        source: settingsSource,
        display: {
          title: entry.label.en,
          titleI18n: { zh: entry.label.zh },
          subtitle: subtitle('en'),
          subtitleI18n: { zh: subtitle('zh') },
          icon: 'Settings',
          // This provider has already matched the explicit term. The full query
          // makes that match survive the shared ranker without changing its rules.
          aliases: [query.trim()],
        },
        behavior: { type: 'perform' },
        surfaces: ['global-launcher'],
        requiredCapabilities: ['settings'],
        recordUsage: false,
        execute: async (ctx) => {
          const current = availableFields().find((candidate) => candidate.sectionId === entry.sectionId && candidate.fieldKey === entry.fieldKey)
          if (!current) return { ok: false, message: translate(ctx.locale, 'palette', 'pluginActionUnavailable') }
          await requestOpenLauncherPluginSettingsSurface(settingsSource, pluginId, { sectionId: entry.sectionId, fieldKey: entry.fieldKey })
          return { ok: true, keepOpen: ctx.surfaceId === 'global-launcher' }
        },
      })
      if (items.length >= SETTINGS_FIELD_RESULT_LIMIT) return items
    }
  }
  return items
}
