import type { PluginDefinition } from '@hiven/plugin'
import { colorAnswer } from './colorCore'

const definition: PluginDefinition = {
  launcher: {
    dynamicItems(ctx) {
      if (ctx.surfaceId !== 'global-launcher' || ctx.signal?.aborted) return []
      const answer = colorAnswer(ctx.query)
      if (!answer) return []
      return answer.formats.map(({ format, text }) => ({
        id: `color-${format}`,
        display: {
          title: text,
          subtitle: ctx.t('result.copy', { format: format.toUpperCase(), hex: answer.hex }),
          icon: answer.icon,
        },
        behavior: { type: 'perform' as const },
        surfaces: ['global-launcher' as const],
        directAnswer: true,
        async execute(run) {
          await run.api.copyText(text)
          return { ok: true as const }
        },
      }))
    },
  },
}

export default definition
