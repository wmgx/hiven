import { translate, type Locale } from '../../i18n'
import { localizedDisplay, resolveDisplayTitle } from '../launcher/display'
import type { LauncherItem, LauncherParamSpec, SaveableParamValue } from '../launcher/types'
import { isGlobalLauncherSavedActionOutput, savedActionDisabledReason } from './compatibility'
import type { SavedActionDisabledReason, SavedActionV1 } from './types'

const disabledKeys = {
  'ambiguous-action': 'savedActionAmbiguous',
  'missing-action': 'savedActionMissing',
  'contract-changed': 'savedActionContractChanged',
  'policy-changed': 'savedActionPolicyChanged',
  'saveability-changed': 'savedActionSaveabilityChanged',
  'input-unavailable': 'savedActionInputUnavailable',
  'output-unavailable': 'savedActionOutputUnavailable',
} as const

export function savedActionDisabledMessage(reason: SavedActionDisabledReason, locale: Locale): string {
  return translate(locale, 'palette', disabledKeys[reason])
}

/** Called only after the current action schema has validated all saved values. */
function paramValueLabel(param: LauncherParamSpec, value: SaveableParamValue, locale: Locale): string {
  if (param.type === 'text') {
    // Persistence permission does not establish that free text is safe for lists.
    return translate(locale, 'palette', value ? 'savedActionParamSet' : 'savedActionParamEmpty')
  }
  if (param.type === 'boolean') return translate(locale, 'palette', value ? 'boolYes' : 'boolNo')
  if (param.type === 'number') return String(value)
  const optionLabel = (selected: string) => {
    const option = param.options?.find((entry) => (typeof entry === 'string' ? entry : entry.value) === selected)
    return typeof option === 'string' ? option : localizedDisplay(option!.label, option!.labelI18n, locale)
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(optionLabel).join(', ') : translate(locale, 'palette', 'savedActionParamEmpty')
  }
  return optionLabel(value as string)
}

/** Shared list and deletion description; never expose stale or unvalidated settings. */
export function describeSavedAction(
  artifact: SavedActionV1,
  baseAction: LauncherItem | null,
  inputAvailable?: boolean,
  sourceAmbiguous = false,
) {
  const disabledReason = sourceAmbiguous ? 'ambiguous-action' : savedActionDisabledReason(artifact, baseAction, {
    inputAvailable,
    outputAvailable: isGlobalLauncherSavedActionOutput(artifact.outputIntent),
  })
  const subtitle = (locale: Locale): string => {
    if (disabledReason) return savedActionDisabledMessage(disabledReason, locale)
    const action = baseAction!
    const params = (action.params ?? [])
      .filter((param) => param.saveable === true && Object.prototype.hasOwnProperty.call(artifact.savedParams, param.key))
      .map((param) => `${localizedDisplay(param.label, param.labelI18n, locale)}: ${paramValueLabel(param, artifact.savedParams[param.key], locale)}`)
    return [
      translate(locale, 'palette', `learningOutput.${artifact.outputIntent}`),
      resolveDisplayTitle(action.display, locale),
      ...params,
    ].join(' · ')
  }
  return { disabledReason, subtitle: subtitle('en'), subtitleI18n: { zh: subtitle('zh') } }
}
