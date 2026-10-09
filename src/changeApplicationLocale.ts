import { useAppStore } from './store'
import type { Locale } from './i18n'
import { reloadPageAfterHotkeysStop } from './hotkeys/pageReload'

/** Monaco NLS and plugin startup contexts need a fresh page after changing locale. */
export async function changeApplicationLocale(locale: Locale): Promise<void> {
  const previous = useAppStore.getState().locale
  if (locale === previous) return
  let committed = false
  try {
    await reloadPageAfterHotkeysStop(() => {
      if (useAppStore.getState().locale !== previous) throw new Error('Language changed during reload preparation')
      committed = true
      useAppStore.getState().updateSetting('locale', locale)
    })
  } catch (error) {
    if (committed && useAppStore.getState().locale === locale) {
      try {
        useAppStore.getState().updateSetting('locale', previous)
      } catch {
        // A storage failure can also reject the rollback write after restoring memory.
      }
    }
    throw error
  }
}
