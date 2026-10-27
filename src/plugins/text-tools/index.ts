import { definePlugin } from '@hiven/plugin'
import { lineTools } from './line/tools'
import { jsonTools } from './json/tools'
import { encodeTools } from './encode/tools'
import { formatTools } from './format/tools'
import { hashTools } from './hash/tools'
import { pathTools } from './paths/tools'
import { UrlQuerySurface } from './json/UrlQuerySurface'
import './style.css'

export default definePlugin({
  tools: [...lineTools, ...jsonTools, ...encodeTools, ...formatTools, ...hashTools, ...pathTools],
  ui: { surfaces: [{
    id: 'url-query', kind: 'custom-view', title: 'urlQuery.title', icon: 'Link',
    aliases: ['edit URL parameters', 'URL query editor', '编辑 URL 参数'],
    component: UrlQuerySurface,
    entry: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, shortcutBindable: true },
    shell: { defaultWidth: 728, defaultHeight: 520, minWidth: 560, minHeight: 360, resizable: true, closeOnBlur: false },
  }] },
})
