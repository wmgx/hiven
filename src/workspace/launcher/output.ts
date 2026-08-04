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
  LauncherSurfaceId,
  PluginLauncherApi,
} from './types'
import { normalizeLauncherSurfaceId } from './types'
import { translate, type Locale } from '../../i18n'

export const TEXT_OUTPUT_CHOICE_ID = 'launcher.text-output'
export const REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID = 'launcher.replace-active-text-output'

function palette(locale: Locale, key: string): string {
  return translate(locale, 'palette', key)
}

/**
 * Build a default text-output result. Shown as one choice; Enter copies the text.
 * `api` is captured so the copy action can run without re-plumbing.
 */
export function textResult(text: string, api: PluginLauncherApi, locale: Locale = 'en'): LauncherExecuteResult {
  const choice: LauncherResultChoice = {
    id: TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    primaryAction: async () => {
      // Silent copy: toast after ↵ 复制 is noise (launcher often closes anyway).
      await api.copyText(text)
    },
    secondaryActions: [
      {
        id: 'return-to-launcher',
        title: palette(locale, 'returnToLauncher'),
        icon: 'CornerDownLeft',
        run: async () => {
          await api.returnToLauncher(text)
          return { ok: true, keepOpen: true }
        },
      },
      {
        id: 'open-quick-editor',
        title: palette(locale, 'openQuickEditor'),
        icon: 'SquarePen',
        run: async () => {
          // Default replaceActiveText overwrites Quick Editor with one-step rollback.
          await api.replaceActiveText(text)
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
export function replaceActiveTextResult(text: string, api: PluginLauncherApi, locale: Locale = 'en'): LauncherExecuteResult {
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
        title: palette(locale, 'copy'),
        icon: 'Copy',
        run: async () => {
          await api.copyText(text)
        },
      },
      {
        id: 'insert',
        title: palette(locale, 'insert'),
        icon: 'TextCursorInput',
        run: async () => {
          await api.insertText(text)
        },
      },
    ],
  }
  return { ok: true, output: { choices: [choice] } }
}

/**
 * Pick the surface-appropriate text-output builder for a plain text result.
 * Global Launcher has no bound pane, so it gets textResult (primary=copy,
 * secondary=return-to-launcher); pane-bound surfaces (editor-command-bar,
 * quick-editor-command) get replaceActiveTextResult (primary=replace,
 * secondary=copy+insert). Shared by any host-owned launcher item that
 * produces text output across multiple surfaces (e.g. pipelineLauncher.ts).
 * toolAdapter.ts's per-tool makeOutput() has its own equivalent inline branch
 * and is intentionally left as-is (not this task's scope).
 */
export function surfaceTextResult(
  text: string,
  api: PluginLauncherApi,
  locale: Locale,
  surfaceId: LauncherSurfaceId,
): LauncherExecuteResult {
  return normalizeLauncherSurfaceId(surfaceId) === 'global-launcher'
    ? textResult(text, api, locale)
    : replaceActiveTextResult(text, api, locale)
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
