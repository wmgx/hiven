/**
 * Switch Window as a first-level host command with collect-input second level
 * (same UX as Kill Process: select command → filter suggestions → pick row → focus).
 *
 * Global mixed ranking of individual windows stays on getHostWindowLauncherDynamicItems.
 */

import type {
  LauncherItem,
  LauncherOutput,
  LauncherResultChoice,
  LauncherSuggestContext,
} from '../launcher/types'
import {
  focusDesktopWindow,
  listSwitchableWindowsForFilter,
  type DesktopWindow,
} from './windows'

function windowToChoice(entry: {
  win: DesktopWindow
  title: string
  subtitle: string
  icon: string
}): LauncherResultChoice {
  const { win, title, subtitle, icon } = entry
  return {
    id: `window:${win.id}`,
    title,
    titleI18n: { en: title, zh: title },
    subtitle,
    subtitleI18n: { en: subtitle, zh: subtitle },
    icon,
    primaryAction: async () => {
      try {
        await focusDesktopWindow(win.id)
        return { ok: true as const }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

async function loadWindowChoices(
  filter: string,
  locale: LauncherSuggestContext['locale'],
): Promise<LauncherResultChoice[]> {
  const list = await listSwitchableWindowsForFilter(filter, locale)
  return list.map(windowToChoice)
}

/**
 * Static first-level host command: "Switch Window".
 * Second level uses collect-input + suggest — only windows, filterable.
 */
export function getSwitchWindowHostItem(): LauncherItem {
  return {
    systemKey: 'host:window:switch-command',
    kind: 'host',
    display: {
      title: 'Switch Window',
      titleI18n: { en: 'Switch Window', zh: '切换窗口' },
      subtitle: 'Select a window to focus',
      subtitleI18n: {
        en: 'Select a window to focus',
        zh: '选择要切换到的窗口',
      },
      icon: 'AppWindow',
      aliases: [
        'switch window',
        'switch',
        'focus window',
        'window',
        'windows',
        '切换窗口',
        '切窗口',
        '窗口切换',
        '切到',
        '窗口',
      ],
      kindLabel: 'Window',
      kindLabelI18n: { en: 'Window', zh: '窗口' },
    },
    behavior: {
      type: 'collect-input',
      input: {
        placeholder: 'Filter windows…',
        placeholderI18n: {
          en: 'Filter windows…',
          zh: '过滤窗口…',
        },
        allowEmptyInput: true,
        emptyInputMessage: 'Select a window from the list',
        emptyInputMessageI18n: {
          en: 'Select a window from the list',
          zh: '请从列表中选择窗口',
        },
      },
    },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-windows'],
    recordUsage: true,
    suggest: async (ctx: LauncherSuggestContext) => {
      const choices = await loadWindowChoices(ctx.inputText, ctx.locale)
      return { choices } satisfies LauncherOutput
    },
    execute: async (ctx) => {
      // Free-text submit without picking a row: unique match → focus.
      const filter = (ctx.input?.text ?? '').trim()
      const choices = await loadWindowChoices(filter, ctx.locale)
      if (choices.length === 1) {
        return choices[0].primaryAction()
      }
      if (choices.length === 0) {
        return {
          ok: false as const,
          message:
            ctx.locale === 'zh'
              ? '未找到匹配窗口，请从列表中选择'
              : 'No matching window — pick one from the list',
        }
      }
      return {
        ok: false as const,
        message:
          ctx.locale === 'zh'
            ? '多个匹配，请用方向键选择窗口后回车'
            : 'Multiple matches — highlight a window and press Enter',
      }
    },
  }
}

export function isSwitchWindowCommandKey(systemKey: string): boolean {
  return systemKey === 'host:window:switch-command'
}
