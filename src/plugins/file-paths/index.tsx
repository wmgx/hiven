import { definePlugin } from '@hiven/plugin'
import { FilePathsSurface } from './FilePathsSurface'
import './style.css'

export const filePathsPlugin = definePlugin({
  ui: { surfaces: [{
    id: 'main', kind: 'custom-view', title: 'File Paths', titleI18n: { zh: '文件路径转换' }, icon: 'Folder',
    aliases: ['file paths', 'path convert', 'posix', 'file uri', 'relative path', 'filename', '文件路径', '相对路径', '文件名'],
    component: FilePathsSurface,
    entry: { launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] }, shortcutBindable: true },
    shell: { defaultWidth: 860, defaultHeight: 640, minWidth: 640, minHeight: 440, closeOnBlur: false, resizable: true },
  }] },
})
export default filePathsPlugin
