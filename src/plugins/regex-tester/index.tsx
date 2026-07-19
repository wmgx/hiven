/**
 * First-party Regex Tester plugin.
 *
 * Provides the regex tester command and panel, migrated from the internal
 * corePlugin to a standalone first-party plugin package.
 */

import { definePlugin, type PaneInput } from '@hiven/plugin'
import { RegexTesterPluginPanel, RegexTesterSurface } from './RegexTesterViews'

export const regexTesterPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Regex Tester',
        titleI18n: { zh: 'Regex Tester' },
        icon: 'Regex',
        aliases: ['regex', 'regexp', 'regular expression', '正则', '正则表达式'],
        component: RegexTesterSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: {
          defaultWidth: 900,
          defaultHeight: 620,
          minWidth: 680,
          minHeight: 440,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
  launcher: {
    items: [
      {
        id: 'regex-tester.open',
        display: {
          title: 'command.open.title',
          subtitle: 'command.open.description',
          icon: 'regex',
          aliases: ['regex', 'regexp', '正则'],
        },
        surfaces: ['command-palette'],
        execute(ctx) {
          const result = ctx.api.dispatchEffects([{
            type: 'panel.openV2' as const,
            panelId: 'regex-tester.panel',
            placement: 'pane-bottom' as const,
            scope: { type: 'pane' as const, paneId: ctx.api.getPaneSnapshot().activePaneId },
            ownerPluginId: 'regex-tester',
          }])
          if (result.errors.length > 0) return { ok: false, message: result.errors[0] }
          return { ok: true }
        },
      },
    ],
  },
  commands: [
    {
      id: 'regex-tester.open',
      title: 'command.open.title',
      description: 'command.open.description',
      icon: 'regex',
      aliases: ['regex', 'regexp', '正则'],
      inputs: [{ key: 'input', label: 'Input', kind: 'pane' as const, required: true }],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const paneId = (ctx.inputs.input as PaneInput).paneId
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: 'regex-tester.panel',
            placement: 'pane-bottom' as const,
            scope: { type: 'pane' as const, paneId },
            ownerPluginId: 'regex-tester',
          }],
        }
      },
    },
  ],
  panels: [
    {
      id: 'regex-tester.panel',
      title: 'panel.main.title',
      defaultPlacement: 'bottom',
      component: RegexTesterPluginPanel,
    },
  ],
})

export default regexTesterPlugin
