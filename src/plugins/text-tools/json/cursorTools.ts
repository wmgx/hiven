import type { PluginToolContribution } from '@hiven/plugin'
import { jsonCursorPath } from './cursorPath'
import { isJson } from './jsonCore'

export const cursorTools: PluginToolContribution[] = (['jsonPath', 'pointer'] as const).map(format => ({
  id: `json.copy-${format}`, title: `cursor.${format}`, icon: 'Copy',
  inputPolicy: { mode: 'auto' }, policy: { effect: 'pure' }, textMatch: isJson,
  surfaces: { launcher: { surfaces: ['quick-editor-command'] } },
  run(ctx) {
    const result = jsonCursorPath(ctx.input.text, ctx.input.cursorOffset ?? -1)
    if (!result.ok) return ctx.output.error(ctx.t(`cursor.error.${result.reason}`))
    const text = result.value[format]
    return ctx.output.choices([{
      id: `json.copy-${format}`, title: text || ctx.t('cursor.root'), preview: text,
      primaryAction: () => ctx.api.copyText(text),
    }])
  },
}))
