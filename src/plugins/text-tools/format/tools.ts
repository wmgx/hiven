import { type PluginToolContribution, getPluginHostSdk, type PluginToolSurfaces } from '@hiven/plugin'
import { formatterErrorMessage, formatText } from './core'
import { CssFormatterError } from './lexical'
import { XmlFormatterError } from './xml'

function matchesContentKind(text: string, kind: 'css' | 'sql' | 'xml'): boolean {
  return getPluginHostSdk().kits.content.detectContent(text).some((item) => item.kind === kind)
}

const TEXT_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['global-launcher', 'quick-editor-command'] },
  panel: true,
}


const PURE_ACTION_POLICY = { effect: 'pure' } as const
export const formatTools: PluginToolContribution[] = [
    {
      id: 'css.prettify',
      title: 'css.prettify.title',
      subtitle: 'css.prettify.description',
      icon: 'Paintbrush',
      aliases: ['css format', 'css格式化', 'css beautify', 'format css', 'pretty css', '格式化'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['css'] },
      textMatch: (text) => matchesContentKind(text, 'css'),
      run(ctx) {
        try { return ctx.output.text(formatText('css', 'format', ctx.input.text)) }
        catch (error) { return ctx.output.error(ctx.t(error instanceof CssFormatterError ? 'error.invalidCss' : 'error.format', { message: formatterErrorMessage(error) })) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'css.compact',
      title: 'css.compact.title',
      subtitle: 'css.compact.description',
      icon: 'Paintbrush',
      aliases: ['css minify', 'css压缩', 'css compress', 'minify css', 'compact css', '压缩'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['css'] },
      textMatch: (text) => matchesContentKind(text, 'css'),
      run(ctx) {
        try { return ctx.output.text(formatText('css', 'compact', ctx.input.text)) }
        catch (error) { return ctx.output.error(ctx.t(error instanceof CssFormatterError ? 'error.invalidCss' : 'error.format', { message: formatterErrorMessage(error) })) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'sql.prettify',
      title: 'sql.prettify.title',
      subtitle: 'sql.prettify.description',
      icon: 'Database',
      aliases: ['sql format', 'sql格式化', 'sql beautify', 'format sql', 'pretty sql', '格式化'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['sql'] },
      textMatch: (text) => matchesContentKind(text, 'sql'),
      run(ctx) {
        try { return ctx.output.text(formatText('sql', 'format', ctx.input.text)) }
        catch (error) { return ctx.output.error(ctx.t('error.format', { message: formatterErrorMessage(error) })) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'sql.compact',
      title: 'sql.compact.title',
      subtitle: 'sql.compact.description',
      icon: 'Database',
      aliases: ['sql minify', 'sql压缩', 'sql compress', 'minify sql', 'compact sql', '压缩'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['sql'] },
      textMatch: (text) => matchesContentKind(text, 'sql'),
      run(ctx) { return ctx.output.text(formatText('sql', 'compact', ctx.input.text)) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'xml.prettify',
      title: 'xml.prettify.title',
      subtitle: 'xml.prettify.description',
      icon: 'Code',
      aliases: ['xml format', 'xml格式化', 'xml beautify', 'format xml', 'pretty xml', '格式化'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['xml'] },
      textMatch: (text) => matchesContentKind(text, 'xml'),
      run(ctx) {
        try { return ctx.output.text(formatText('xml', 'format', ctx.input.text)) }
        catch (error) {
          return ctx.output.error(error instanceof XmlFormatterError
            ? ctx.t(`error.${error.code}`)
            : ctx.t('error.format', { message: formatterErrorMessage(error) }))
        }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'xml.compact',
      title: 'xml.compact.title',
      subtitle: 'xml.compact.description',
      icon: 'Code',
      aliases: ['xml minify', 'xml压缩', 'xml compress', 'minify xml', 'compact xml', '压缩'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['xml'] },
      textMatch: (text) => matchesContentKind(text, 'xml'),
      run(ctx) {
        try { return ctx.output.text(formatText('xml', 'compact', ctx.input.text)) }
        catch (error) {
          return ctx.output.error(error instanceof XmlFormatterError
            ? ctx.t(`error.${error.code}`)
            : ctx.t('error.format', { message: formatterErrorMessage(error) }))
        }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
  ]
