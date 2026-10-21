/**
 * First-party Regex Tester plugin.
 *
 * Regex tester as a single launcher-entered surface (no pane panel).
 */

import { definePlugin } from '@hiven/plugin'
import { RegexTesterSurface } from './RegexTesterViews'
import './style.css'

const WORKSPACE_SHELL = {
  defaultWidth: 900,
  defaultHeight: 620,
  minWidth: 680,
  minHeight: 440,
  closeOnBlur: false,
  resizable: true,
}

export const regexTesterPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Regex Tester',
        titleI18n: { zh: '正则测试器' },
        icon: 'Regex',
        aliases: ['regex', 'regexp', 'regular expression', '正则', '正则表达式', 'regex test', 'regex match', 'test regex', 'regular expression tester', '正则测试', '正则匹配'],
        component: RegexTesterSurface,
        entry: { launcher: { surfaces: ['global-launcher'] }, shortcutBindable: true },
        shell: WORKSPACE_SHELL,
      },
    ],
  },
})

export default regexTesterPlugin
