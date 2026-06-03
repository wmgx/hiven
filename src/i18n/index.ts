import { nav } from './locales/nav'
import { editor } from './locales/editor'
import { scripts } from './locales/scripts'
import { pluginEditor } from './locales/pluginEditor'
import { debuggerPanel } from './locales/debugger'
import { settings } from './locales/settings'
import { palette } from './locales/palette'
import { workspace } from './locales/workspace'
import { update } from './locales/update'

export type Locale = 'zh' | 'en'

type LocaleModule = Record<Locale, Record<string, string>>

const modules: LocaleModule[] = [
  nav,
  editor,
  scripts,
  pluginEditor,
  debuggerPanel,
  settings,
  palette,
  workspace,
  update,
]

function mergeLocale(locale: Locale): Record<string, string> {
  return Object.assign({}, ...modules.map((mod) => mod[locale]))
}

const messages: Record<Locale, Record<string, string>> = {
  en: mergeLocale('en'),
  zh: mergeLocale('zh'),
}

export type MessageKey =
  | keyof typeof nav['en']
  | keyof typeof editor['en']
  | keyof typeof scripts['en']
  | keyof typeof pluginEditor['en']
  | keyof typeof debuggerPanel['en']
  | keyof typeof settings['en']
  | keyof typeof palette['en']
  | keyof typeof workspace['en']
  | keyof typeof update['en']

export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  let value: string = messages[locale]?.[key] ?? messages['en'][key] ?? key
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
  }
  return value
}
