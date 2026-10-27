import en from './locales/en.json'
import zh from './locales/zh.json'
import { definePlugin } from '@hiven/plugin'
import { additionalTools } from './additionalTools'
import { lineTools } from './line/tools'
import { cursorTools } from './json/cursorTools'
import { jsonTools } from './json/tools'
import { encodeTools } from './encode/tools'
import { formatTools } from './format/tools'
import { hashTools } from './hash/tools'
import { pathTools } from './paths/tools'
import { UrlQuerySurface } from './json/UrlQuerySurface'
import './style.css'

export default definePlugin({
  tools: [...lineTools, ...jsonTools, ...encodeTools, ...formatTools, ...hashTools, ...pathTools, ...additionalTools, ...cursorTools],
  ui: { surfaces: [{
    id: 'url-query', kind: 'custom-view', title: en['urlQuery.title'], titleI18n: { zh: zh['urlQuery.title'] }, icon: 'Link',
    aliases: ['edit URL parameters', 'URL query editor', '编辑 URL 参数'],
    component: UrlQuerySurface,
    entry: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, shortcutBindable: true },
    shell: { size: 'medium' as const, inlineHeight: 640, resizable: true, closeOnBlur: false },
  }] },
})
