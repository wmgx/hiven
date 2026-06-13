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
  PluginLauncherApi,
} from './types'

export const TEXT_OUTPUT_CHOICE_ID = 'launcher.text-output'
export const REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID = 'launcher.replace-active-text-output'

/**
 * Build a default text-output result. Shown as one choice; Enter copies the text.
 * `api` is captured so the copy action can run without re-plumbing.
 */
export function textResult(text: string, api: PluginLauncherApi): LauncherExecuteResult {
  const choice: LauncherResultChoice = {
    id: TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    primaryAction: async () => {
      await api.copyText(text)
      api.showMessage('Copied', 'success')
    },
    secondaryActions: [
      {
        id: 'replace-active',
        title: 'Replace active text',
        run: async () => {
          await api.replaceActiveText(text)
        },
      },
      {
        id: 'insert',
        title: 'Insert',
        run: async () => {
          await api.insertText(text)
        },
      },
    ],
  }
  return { ok: true, output: { choices: [choice] } }
}

/**
 * Text output whose primary (Enter) action replaces the active text instead of
 * copying. Still shows the value as the choice title/preview.
 */
export function replaceActiveTextResult(text: string, api: PluginLauncherApi): LauncherExecuteResult {
  const choice: LauncherResultChoice = {
    id: REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    primaryAction: async () => {
      await api.replaceActiveText(text)
    },
    secondaryActions: [
      {
        id: 'copy',
        title: 'Copy',
        run: async () => {
          await api.copyText(text)
          api.showMessage('Copied', 'success')
        },
      },
    ],
  }
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
