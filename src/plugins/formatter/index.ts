/**
 * First-party Formatter plugin.
 *
 * SQL, CSS, and XML formatting workspace plus editor commands.
 */

import { definePlugin, getPluginHostSdk, type PluginToolSurfaces } from '@hiven/plugin'
import { FormatterSurface } from './FormatterSurface'
import { formatterErrorMessage, formatterRoutes, formatText } from './core'
import './style.css'

function matchesContentKind(text: string, kind: 'css' | 'sql' | 'xml'): boolean {
  return getPluginHostSdk().kits.content.detectContent(text).some((item) => item.kind === kind)
}

const EDITOR_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] },
  panel: true,
}

const WORKSPACE_SHELL = {
  defaultWidth: 860,
  defaultHeight: 640,
  minWidth: 640,
  minHeight: 420,
  closeOnBlur: false,
  resizable: true,
}

export const formatterPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Formatter',
        titleI18n: { zh: '格式化工具' },
        icon: 'Braces',
        aliases: ['formatter', 'format', 'formatter tools', '格式化', '格式化工具', 'geshihua'],
        textMatch: (text) => (['css', 'sql', 'xml'] as const).some((kind) => matchesContentKind(text, kind)),
        component: FormatterSurface,
        entry: {
          launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] },
          shortcutBindable: true,
        },
        shell: WORKSPACE_SHELL,
      },
      ...formatterRoutes.map((route) => ({
        id: route.id,
        kind: 'custom-view' as const,
        title: 'Formatter',
        titleI18n: { zh: '格式化工具' },
        component: FormatterSurface,
        entry: { launcher: false },
        shell: WORKSPACE_SHELL,
      })),
    ],
  },
  launcher: {
    items: formatterRoutes.map((route) => ({
      id: `open-${route.id}`,
      display: {
        title: route.titleKey,
        subtitle: 'route.open',
        icon: route.language === 'sql' ? 'Database' : route.language === 'css' ? 'Paintbrush' : 'Code',
        aliases: route.aliases,
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      execute(execution) {
        execution.api.openSurface(route.id, { initialText: execution.input?.text })
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
  tools: [
    {
      id: 'css.prettify',
      title: 'css.prettify.title',
      subtitle: 'css.prettify.description',
      icon: 'Paintbrush',
      aliases: ['css format', 'css格式化', 'css beautify', 'format css', 'pretty css', '格式化'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['css'] },
      textMatch: (text) => matchesContentKind(text, 'css'),
      run(ctx) { return ctx.output.text(formatText('css', 'format', ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'css.compact',
      title: 'css.compact.title',
      subtitle: 'css.compact.description',
      icon: 'Paintbrush',
      aliases: ['css minify', 'css压缩', 'css compress', 'minify css', 'compact css', '压缩'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['css'] },
      textMatch: (text) => matchesContentKind(text, 'css'),
      run(ctx) { return ctx.output.text(formatText('css', 'compact', ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'sql.prettify',
      title: 'sql.prettify.title',
      subtitle: 'sql.prettify.description',
      icon: 'Database',
      aliases: ['sql format', 'sql格式化', 'sql beautify', 'format sql', 'pretty sql', '格式化'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['sql'] },
      textMatch: (text) => matchesContentKind(text, 'sql'),
      run(ctx) {
        try { return ctx.output.text(formatText('sql', 'format', ctx.input.text)) }
        catch (error) { return ctx.output.error(ctx.t('error.format', { message: formatterErrorMessage(error) })) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'sql.compact',
      title: 'sql.compact.title',
      subtitle: 'sql.compact.description',
      icon: 'Database',
      aliases: ['sql minify', 'sql压缩', 'sql compress', 'minify sql', 'compact sql', '压缩'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['sql'] },
      textMatch: (text) => matchesContentKind(text, 'sql'),
      run(ctx) { return ctx.output.text(formatText('sql', 'compact', ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'xml.prettify',
      title: 'xml.prettify.title',
      subtitle: 'xml.prettify.description',
      icon: 'Code',
      aliases: ['xml format', 'xml格式化', 'xml beautify', 'format xml', 'pretty xml', '格式化'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['xml'] },
      textMatch: (text) => matchesContentKind(text, 'xml'),
      run(ctx) { return ctx.output.text(formatText('xml', 'format', ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'xml.compact',
      title: 'xml.compact.title',
      subtitle: 'xml.compact.description',
      icon: 'Code',
      aliases: ['xml minify', 'xml压缩', 'xml compress', 'minify xml', 'compact xml', '压缩'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['xml'] },
      textMatch: (text) => matchesContentKind(text, 'xml'),
      run(ctx) { return ctx.output.text(formatText('xml', 'compact', ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
  ],
})

export default formatterPlugin
