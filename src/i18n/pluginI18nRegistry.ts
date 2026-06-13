/**
 * Plugin i18n integration with the unified registry.
 *
 * This module bridges the plugin loading pipeline with the unified i18n registry.
 * It handles:
 *   1. Registering/unregistering plugin messages via the unified registry
 *   2. Load-time contribution localization (expanding keys into { text, textI18n })
 *
 * Public API for plugin loader:
 *   - registerPluginMessages(pluginId, messages)  — called during plugin load
 *   - unregisterPluginMessages(pluginId)          — called during plugin disable
 *   - localizeContributions(pluginId, contributions) — expand locale keys
 */

import { registerMessages, unregisterMessages, getMessages, type Locale, type Messages } from './registry'
import type {
  CommandContribution,
  CommandParam,
  InputSlot,
  PanelContributionV2,
  PluginDefinition,
  PluginSettingsContribution,
  RendererContribution,
  ToolbarContribution,
} from '../workspace/pluginTypes'
import type {
  LauncherInputSpec,
  LauncherItemContribution,
  LauncherItemDisplay,
  PanelActionContribution,
  PluginToolContribution,
} from '../workspace/launcher/types'

export type { Messages as PluginMessages } from './registry'

const SUPPORTED_LOCALES: Locale[] = ['en', 'zh']

/**
 * Register plugin messages into the unified registry.
 * The pluginId becomes the namespace.
 */
export function registerPluginMessages(pluginId: string, messages: Messages): void {
  registerMessages(pluginId, messages)
}

/**
 * Unregister plugin messages from the unified registry.
 */
export function unregisterPluginMessages(pluginId: string): void {
  unregisterMessages(pluginId)
}

/**
 * Clear all plugin messages. Delegates to unregister for known plugins.
 * @deprecated — prefer unregisterPluginMessages per plugin on disable.
 */
export function clearPluginMessages(): void {
  // No-op; plugins are individually unregistered when disabled.
}

// ─── Legacy compat: makePluginT ──────────────────────────────────────────────
// Used by pluginHostSdk's hooks.useT(pluginId) — still needed during migration
// of existing plugins. Once all plugins use the Context-based useT(), this can
// be removed.

import { translate } from './registry'

export type PluginT = (key: string, vars?: Record<string, string | number>) => string

/**
 * Build a translate function bound to a plugin namespace and locale.
 * @deprecated — plugins should use useT() from context instead.
 */
export function makePluginT(pluginId: string, locale: Locale): PluginT {
  return (key, vars) => translate(locale, pluginId, key, vars)
}

// ─── Contribution Localization (load-time) ─────────────────────────────────────

type I18nMap = Partial<Record<Locale, string>>

/** Build a per-locale map for a key; returns null when no locale defines it. */
function localizeKey(messages: Messages, key: string): { text: string; i18n: I18nMap } | null {
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
  const text = i18n.en ?? SUPPORTED_LOCALES.map((l) => i18n[l]).find((v) => v != null) ?? key
  return { text, i18n }
}

function localizeParam(messages: Messages, param: CommandParam): CommandParam {
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

function localizeInputSlot(messages: Messages, slot: InputSlot): InputSlot {
  const label = localizeKey(messages, slot.label)
  if (!label) return slot
  return { ...slot, label: label.text, labelI18n: { ...label.i18n, ...slot.labelI18n } }
}

function localizeCommand(messages: Messages, command: CommandContribution): CommandContribution {
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

function localizeRenderer(messages: Messages, renderer: RendererContribution): RendererContribution {
  const title = localizeKey(messages, renderer.title)
  if (!title) return renderer
  return { ...renderer, title: title.text, titleI18n: { ...title.i18n, ...renderer.titleI18n } }
}

function localizePanel(messages: Messages, panel: PanelContributionV2): PanelContributionV2 {
  const title = localizeKey(messages, panel.title)
  if (!title) return panel
  return { ...panel, title: title.text, titleI18n: { ...title.i18n, ...panel.titleI18n } }
}

function localizeToolbar(messages: Messages, item: ToolbarContribution): ToolbarContribution {
  const title = localizeKey(messages, item.title)
  if (!title) return item
  return { ...item, title: title.text, titleI18n: { ...title.i18n, ...item.titleI18n } }
}

function localizeDisplay(messages: Messages, display: LauncherItemDisplay): LauncherItemDisplay {
  const next: LauncherItemDisplay = { ...display }
  const title = localizeKey(messages, display.title)
  if (title) {
    next.title = title.text
    next.titleI18n = { ...title.i18n, ...display.titleI18n }
  }
  if (display.subtitle) {
    const subtitle = localizeKey(messages, display.subtitle)
    if (subtitle) {
      next.subtitle = subtitle.text
      next.subtitleI18n = { ...subtitle.i18n, ...display.subtitleI18n }
    }
  }
  return next
}

function localizeTool<TSettings>(messages: Messages, tool: PluginToolContribution<TSettings>): PluginToolContribution<TSettings> {
  const next: PluginToolContribution<TSettings> = { ...tool }
  const title = localizeKey(messages, tool.title)
  if (title) {
    next.title = title.text
    next.titleI18n = { ...title.i18n, ...tool.titleI18n }
  }
  if (tool.subtitle) {
    const subtitle = localizeKey(messages, tool.subtitle)
    if (subtitle) {
      next.subtitle = subtitle.text
      next.subtitleI18n = { ...subtitle.i18n, ...tool.subtitleI18n }
    }
  }
  return next
}

function localizeLauncherInputSpec(messages: Messages, input: LauncherInputSpec): LauncherInputSpec {
  const next: LauncherInputSpec = { ...input }
  if (input.placeholder) {
    const placeholder = localizeKey(messages, input.placeholder)
    if (placeholder) {
      next.placeholder = placeholder.text
      next.placeholderI18n = { ...placeholder.i18n, ...input.placeholderI18n }
    }
  }
  if (input.emptyInputMessage) {
    const message = localizeKey(messages, input.emptyInputMessage)
    if (message) {
      next.emptyInputMessage = message.text
      next.emptyInputMessageI18n = { ...message.i18n, ...input.emptyInputMessageI18n }
    }
  }
  return next
}

function localizeLauncherItem<TSettings>(
  messages: Messages,
  item: LauncherItemContribution<TSettings>,
): LauncherItemContribution<TSettings> {
  const next: LauncherItemContribution<TSettings> = {
    ...item,
    display: localizeDisplay(messages, item.display),
  }
  if (item.behavior?.type === 'collect-input') {
    next.behavior = {
      ...item.behavior,
      input: localizeLauncherInputSpec(messages, item.behavior.input),
    }
  }
  return next
}

function localizePanelAction<TSettings>(
  messages: Messages,
  action: PanelActionContribution<TSettings>,
): PanelActionContribution<TSettings> {
  const title = localizeKey(messages, action.title)
  if (!title) return action
  return { ...action, title: title.text, titleI18n: { ...title.i18n, ...action.titleI18n } }
}

function localizeSettings<TSettings>(
  messages: Messages,
  settings: PluginSettingsContribution<TSettings> | undefined,
): PluginSettingsContribution<TSettings> | undefined {
  if (!settings?.title) return settings
  const title = localizeKey(messages, settings.title)
  if (!title) return settings
  return { ...settings, title: title.text, titleI18n: { ...title.i18n, ...settings.titleI18n } }
}

export type LocalizedContributions<TSettings = unknown> = {
  commands: CommandContribution[]
  renderers: RendererContribution[]
  panels: PanelContributionV2[]
  toolbar: ToolbarContribution[]
  tools: PluginToolContribution<TSettings>[]
  launcher?: PluginDefinition<TSettings>['launcher']
  panel?: PluginDefinition<TSettings>['panel']
  settings?: PluginSettingsContribution<TSettings>
  definition: PluginDefinition<TSettings>
}

/**
 * Expand locale keys in a plugin's contributions into the `{ text, textI18n }`
 * protocol using the plugin's registered messages.
 */
export function localizeContributions(
  pluginId: string,
  contributions: PluginDefinition,
): LocalizedContributions {
  const messages = getMessages(pluginId) ?? {}
  const tools = (contributions.tools ?? []).map((tool) => localizeTool(messages, tool))
  const launcherItems = contributions.launcher?.items?.map((item) => localizeLauncherItem(messages, item))
  const panelActions = contributions.panel?.actions?.map((action) => localizePanelAction(messages, action))
  const launcher = contributions.launcher
    ? { ...contributions.launcher, items: launcherItems }
    : undefined
  const panel = contributions.panel
    ? { ...contributions.panel, actions: panelActions }
    : undefined
  const settings = localizeSettings(messages, contributions.settings)
  const commands = (contributions.commands ?? []).map((c) => localizeCommand(messages, c))
  const renderers = (contributions.renderers ?? []).map((r) => localizeRenderer(messages, r))
  const panels = (contributions.panels ?? []).map((p) => localizePanel(messages, p))
  const toolbar = (contributions.toolbar ?? []).map((tb) => localizeToolbar(messages, tb))
  const definition: PluginDefinition = {
    ...contributions,
    tools,
    launcher,
    panel,
    commands,
    renderers,
    panels,
    toolbar,
    settings,
  }

  return {
    commands,
    renderers,
    panels,
    toolbar,
    tools,
    launcher,
    panel,
    settings,
    definition,
  }
}
