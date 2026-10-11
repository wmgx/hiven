import { definePlugin } from '@hiven/plugin'
import { CurlInspector } from './CurlInspector'
import './style.css'
export default definePlugin({
  ui: { surfaces: [{
    id: 'main', kind: 'custom-view', title: 'cURL Inspector', titleI18n: { zh: 'cURL 解析' }, icon: 'Terminal',
    aliases: ['curl', 'curl parse', 'curl inspector', 'curl解析', '请求解析'],
    component: CurlInspector,
    entry: { launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] }, shortcutBindable: true },
    shell: { defaultWidth: 840, defaultHeight: 660, minWidth: 600, minHeight: 440, closeOnBlur: false, resizable: true },
  }] },
})
