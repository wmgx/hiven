import { definePlugin } from '@hiven/plugin'
import { SummarySurface } from './SummarySurface'
import './style.css'

export default definePlugin({
  ui: {
    surfaces: [{
      id: 'main',
      initialTextMode: 'literal',
      kind: 'custom-view',
      title: 'AI Summary',
      titleI18n: { zh: 'AI 摘要', en: 'AI Summary' },
      icon: 'ListCollapse',
      aliases: ['summary', 'summarize', 'ai writing', '摘要', '总结', 'AI 写作'],
      component: SummarySurface,
      entry: {
        launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] },
        shortcutBindable: true,
      },
      shell: { defaultWidth: 980, defaultHeight: 700, minWidth: 740, minHeight: 540, closeOnBlur: false, resizable: true },
    }],
  },
})
