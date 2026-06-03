/**
 * Plugin i18n registry.
 * Plugins ship locale dictionaries under `locales/{en,zh}.json`. The host
 * registers them per pluginId namespace. The injected `i18n.t(key)` resolves
 * with a three-level fallback:
 *   1. plugin namespace messages (current locale, then en)
 *   2. host global dictionary (via hostT)
 *   3. raw key
 */

import type { Locale } from './index'
import { t as hostT, type MessageKey } from './index'
import type {
  CommandContribution,
  CommandParam,
  InputSlot,
  PanelContributionV2,
  RendererContribution,
} from '../workspace/pluginTypes'

export type PluginMessages = Partial<Record<Locale, Record<string, string>>>

const SUPPORTED_LOCALES: Locale[] = ['en', 'zh']

const registry = new Map<string, PluginMessages>()

export function registerPluginMessages(pluginId: string, messages: PluginMessages): void {
  registry.set(pluginId, messages)
}

export function unregisterPluginMessages(pluginId: string): void {
  registry.delete(pluginId)
}

export function clearPluginMessages(): void {
  registry.clear()
}

function applyVars(value: string, vars?: Record<string, string | number>): string {
  if (!vars) return value
  let out = value
  for (const [name, replacement] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(replacement))
  }
  return out
}

export type PluginT = (key: string, vars?: Record<string, string | number>) => string

/**
 * Build a translate function bound to a plugin namespace and locale.
 * Plugin code only writes short keys; resolution falls back to host dict then key.
 */
export function makePluginT(pluginId: string, locale: Locale): PluginT {
  return (key, vars) => {
    const messages = registry.get(pluginId)
    const localized = messages?.[locale]?.[key] ?? messages?.en?.[key]
    if (localized != null) return applyVars(localized, vars)
    // Fallback to host global dictionary, then raw key (hostT already returns key on miss).
    return hostT(locale, key as MessageKey, vars)
  }
}

// ─── Contribution Localization (load-time) ─────────────────────────────────────
//
// Plugins author contribution fields (title/description/label/hint and option
// labels) as plain locale keys and ship `locales/{en,zh}.json`. At load time the
// host expands each key into the existing `{ text, textI18n }` protocol so that
// downstream consumers (CommandPalette, views) keep using `localized(...)` with
// zero awareness of plugin namespaces.
//
// Resolution per field: if the field value is a key present in the plugin
// messages, expand it to the literal default text plus a full per-locale i18n
// map. If the key is absent from all locales, the value is left untouched so
// legacy inline strings keep working.

type I18nMap = Partial<Record<Locale, string>>

/** Build a per-locale map for a key; returns null when no locale defines it. */
function localizeKey(messages: PluginMessages, key: string): { text: string; i18n: I18nMap } | null {
  const i18n: I18nMap = {}
  let found = false
  for (const locale of SUPPORTED_LOCALES) {
    const value = messages[locale]?.[key]
    if (value != null) {
      i18n[locale] = value
      found = true
    }
  }
  if (!found) return null
  // Default text: prefer en, else the first available locale value.
  const text = i18n.en ?? SUPPORTED_LOCALES.map((l) => i18n[l]).find((v) => v != null) ?? key
  return { text, i18n }
}

function localizeParam(messages: PluginMessages, param: CommandParam): CommandParam {
  const next: CommandParam = { ...param }
  const label = localizeKey(messages, param.label)
  if (label) {
    next.label = label.text
    next.labelI18n = { ...label.i18n, ...param.labelI18n }
  }
  if (param.hint) {
    const hint = localizeKey(messages, param.hint)
    if (hint) {
      next.hint = hint.text
      next.hintI18n = { ...hint.i18n, ...param.hintI18n }
    }
  }
  if (Array.isArray(param.options)) {
    const options = param.options as Array<string | { label: string; value: string; labelI18n?: I18nMap }>
    next.options = options.map((option) => {
      if (typeof option === 'string') return option
      const optLabel = localizeKey(messages, option.label)
      if (!optLabel) return option
      return { ...option, label: optLabel.text, labelI18n: { ...optLabel.i18n, ...option.labelI18n } }
    }) as CommandParam['options']
  }
  return next
}

function localizeInputSlot(messages: PluginMessages, slot: InputSlot): InputSlot {
  const label = localizeKey(messages, slot.label)
  if (!label) return slot
  return { ...slot, label: label.text, labelI18n: { ...label.i18n, ...slot.labelI18n } }
}

function localizeCommand(messages: PluginMessages, command: CommandContribution): CommandContribution {
  const next: CommandContribution = { ...command }
  const title = localizeKey(messages, command.title)
  if (title) {
    next.title = title.text
    next.titleI18n = { ...title.i18n, ...command.titleI18n }
  }
  if (command.description) {
    const description = localizeKey(messages, command.description)
    if (description) {
      next.description = description.text
      next.descriptionI18n = { ...description.i18n, ...command.descriptionI18n }
    }
  }
  if (command.inputs) {
    next.inputs = command.inputs.map((slot) => localizeInputSlot(messages, slot))
  }
  if (command.params) {
    next.params = command.params.map((param) => localizeParam(messages, param))
  }
  return next
}

function localizeRenderer(messages: PluginMessages, renderer: RendererContribution): RendererContribution {
  const title = localizeKey(messages, renderer.title)
  if (!title) return renderer
  return { ...renderer, title: title.text, titleI18n: { ...title.i18n, ...renderer.titleI18n } }
}

function localizePanel(messages: PluginMessages, panel: PanelContributionV2): PanelContributionV2 {
  const title = localizeKey(messages, panel.title)
  if (!title) return panel
  return { ...panel, title: title.text, titleI18n: { ...title.i18n, ...panel.titleI18n } }
}

export type LocalizedContributions = {
  commands: CommandContribution[]
  renderers: RendererContribution[]
  panels: PanelContributionV2[]
}

/**
 * Expand locale keys in a plugin's contributions into the `{ text, textI18n }`
 * protocol using the plugin's registered messages. Call this right before
 * registering contributions so the registry stores fully-resolved entries.
 */
export function localizeContributions(
  pluginId: string,
  contributions: {
    commands?: CommandContribution[]
    renderers?: RendererContribution[]
    panels?: PanelContributionV2[]
  },
): LocalizedContributions {
  const messages = registry.get(pluginId) ?? {}
  return {
    commands: (contributions.commands ?? []).map((c) => localizeCommand(messages, c)),
    renderers: (contributions.renderers ?? []).map((r) => localizeRenderer(messages, r)),
    panels: (contributions.panels ?? []).map((p) => localizePanel(messages, p)),
  }
}
