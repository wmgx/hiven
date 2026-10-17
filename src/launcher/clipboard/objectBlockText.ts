import { translate } from '../../i18n'
import { useAppStore } from '../../store'

/** Object Block display text in the current app locale (`objectBlock` namespace). */
export function objectBlockText(key: string, vars?: Record<string, string | number>): string {
  return translate(useAppStore.getState().locale, 'objectBlock', key, vars)
}
