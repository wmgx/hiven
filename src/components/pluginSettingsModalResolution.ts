import type {
  PluginSettingsContribution,
  PluginSettingsModalContribution,
  PluginSettingsModalField,
} from '../workspace/pluginTypes'

export type ResolvedPluginSettingsModal<TSettings = unknown> = {
  field: PluginSettingsModalField<TSettings>
  modal: PluginSettingsModalContribution<TSettings>
}

export function resolvePluginSettingsModal<TSettings = unknown>(
  contribution: PluginSettingsContribution<TSettings>,
  field: PluginSettingsModalField<TSettings>,
): ResolvedPluginSettingsModal<TSettings> | null {
  const modalId = field.modalId ?? field.surfaceId ?? field.id
  const declared = contribution.modals?.find((modal) => modal.id === modalId)
  if (declared) return { field, modal: declared }
  if (!field.component) return null
  return {
    field,
    modal: {
      id: modalId,
      title: field.label,
      titleI18n: field.labelI18n,
      component: field.component,
    },
  }
}
