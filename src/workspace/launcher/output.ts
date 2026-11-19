/**
 * Launcher Output Helpers
 *
 * Builders for `LauncherExecuteResult` / `LauncherOutput`. The default text
 * output is rendered as a single result choice whose primary (Enter) action
 * copies the text. Plugins/tools can opt into replace-active-text, insert, or
 * raw multi-choice output.
 *
 * These builders are pure and take a `PluginLauncherApi` only at action-run time
 * via closures, so the result object is serializable-ish (actions are closures).
 */

import type {
  LauncherExecuteResult,
  LauncherOutput,
  LauncherResultChoice,
  LauncherResultAction,
  LauncherTextOptions,
  OutputIntent,
  PluginLauncherApi,
} from './types'
import { translate, type Locale } from '../../i18n'

export const TEXT_OUTPUT_CHOICE_ID = 'launcher.text-output'
export const REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID = 'launcher.replace-active-text-output'

type HostOutputActionNode = LauncherResultChoice | LauncherResultAction
const hostOutputIntentByAction = new WeakMap<object, OutputIntent>()

function markHostOutputAction<T extends HostOutputActionNode>(action: T, intent: OutputIntent): T {
  hostOutputIntentByAction.set(action, intent)
  return action
}

/** Host text results can be rebuilt around user-edited text (same actions, new text). */
const hostTextRebuilders = new WeakMap<LauncherResultChoice, (text: string) => LauncherResultChoice>()

/** The same host text result carrying `text`; null for plugin-defined choices. */
export function rebuildHostTextChoice(choice: LauncherResultChoice, text: string): LauncherResultChoice | null {
  return hostTextRebuilders.get(choice)?.(text) ?? null
}

export function isHostTextChoice(choice: LauncherResultChoice): boolean {
  return hostTextRebuilders.has(choice)
}

export function getHostOutputIntent(action: HostOutputActionNode): OutputIntent | null {
  return hostOutputIntentByAction.get(action) ?? null
}

function palette(locale: Locale, key: string): string {
  return translate(locale, 'palette', key)
}

/**
 * Build a default text-output result. Shown as one choice; Enter copies the text.
 * `api` is captured so the copy action can run without re-plumbing.
 */
export function textResult(text: string, api: PluginLauncherApi, locale: Locale = 'en', options: LauncherTextOptions = {}): LauncherExecuteResult {
  return { ok: true, output: { choices: [textChoice(text, api, locale, options)] } }
}

function textChoice(text: string, api: PluginLauncherApi, locale: Locale, options: LauncherTextOptions): LauncherResultChoice {
  const { format, language } = options
  const choice: LauncherResultChoice = markHostOutputAction({
    id: TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    ...(format === 'markdown' ? { previewFormat: format } : {}),
    ...(language ? { previewLanguage: language } : {}),
    primaryAction: async () => {
      // Silent copy: toast after ↵ 复制 is noise (launcher often closes anyway).
      await api.copyText(text)
    },
    secondaryActions: [
      markHostOutputAction({
        id: 'return-to-launcher',
        title: palette(locale, 'returnToLauncher'),
        icon: 'CornerDownLeft',
        run: async () => {
          await api.returnToLauncher(text)
          return { ok: true, keepOpen: true }
        },
      }, 'return-to-launcher'),
      markHostOutputAction({
        id: 'open-quick-editor',
        title: palette(locale, 'openQuickEditor'),
        icon: 'SquarePen',
        run: async () => {
          // Default replaceActiveText overwrites Quick Editor with one-step rollback.
          await api.replaceActiveText(text)
        },
      }, 'open-quick-editor'),
      markHostOutputAction({
        id: 'paste-to-foreground-app',
        title: palette(locale, 'pasteToForegroundApp'),
        icon: 'ClipboardPaste',
        run: async () => {
          await api.pasteToForegroundApp(text)
        },
      }, 'paste-to-foreground-app'),
    ],
  }, 'copy')
  hostTextRebuilders.set(choice, (next) => textChoice(next, api, locale, options))
  return choice
}

/**
 * Text output whose primary (Enter) action replaces the active text instead of
 * copying. Still shows the value as the choice title/preview.
 */
export function replaceActiveTextResult(text: string, api: PluginLauncherApi, locale: Locale = 'en'): LauncherExecuteResult {
  const choice: LauncherResultChoice = markHostOutputAction({
    id: REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    primaryAction: async () => {
      await api.replaceActiveText(text)
    },
    secondaryActions: [
      markHostOutputAction({
        id: 'copy',
        title: palette(locale, 'copy'),
        icon: 'Copy',
        run: async () => {
          await api.copyText(text)
        },
      }, 'copy'),
      markHostOutputAction({
        id: 'insert',
        title: palette(locale, 'insert'),
        icon: 'TextCursorInput',
        run: async () => {
          await api.insertText(text)
        },
      }, 'insert'),
    ],
  }, 'replace-active-text')
  return { ok: true, output: { choices: [choice] } }
}

export function errorResult(message: string): LauncherExecuteResult {
  return { ok: false, message }
}

export function choicesResult(choices: LauncherResultChoice[]): LauncherExecuteResult {
  return { ok: true, output: { choices } }
}

/** Success with no output → launcher should close. */
export function emptyResult(): LauncherExecuteResult {
  return { ok: true }
}

export function isOutputResult(result: LauncherExecuteResult): result is { ok: true; output: LauncherOutput } {
  return result.ok === true && result.output != null && result.output.choices.length > 0
}
