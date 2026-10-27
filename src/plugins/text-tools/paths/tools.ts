import type { PluginToolContribution } from '@hiven/plugin'
import { PathTransformError, transformPaths, type PathFormat, type PathStyle } from './core'

export const pathTools: PluginToolContribution[] = [{
  id: 'paths.convert', title: 'paths.title', icon: 'FileSymlink',
  aliases: ['convert paths', 'file paths', '转换路径', '文件路径'],
  inputPolicy: { mode: 'auto' }, policy: { effect: 'pure' }, requireParamSelection: true,
  params: [
    { key: 'format', label: 'paths.formatLabel', type: 'single-select', default: 'posix', options: ['posix', 'uri', 'relative', 'name', 'markdown-image'].map(value => ({ value, label: `paths.format.${value}` })) },
    { key: 'base', label: 'paths.base', type: 'text', default: '' },
    { key: 'style', label: 'paths.styleLabel', type: 'single-select', default: 'auto', options: ['auto', 'unix', 'windows'].map(value => ({ value, label: `paths.style.${value}` })) },
  ],
  run(ctx) {
    try { return ctx.output.text(transformPaths(ctx.input.text, (ctx.params.format ?? 'posix') as PathFormat, String(ctx.params.base ?? ''), (ctx.params.style ?? 'auto') as PathStyle)) }
    catch (error) { return ctx.output.error(ctx.t(`paths.error.${error instanceof PathTransformError ? error.code : 'invalid'}`)) }
  },
  surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
}]
