import { definePlugin } from '@hiven/plugin'
import { SUMMARY_POINT_LIMITS, SummaryError, type SummaryPointLimit } from './prompt'
import { streamSummary } from './stream'

export default definePlugin({
  tools: [{
    id: 'summarize',
    title: 'tool.title',
    subtitle: 'tool.description',
    icon: 'ListCollapse',
    aliases: ['summary', 'summarize', 'ai writing', '摘要', '总结', 'AI 写作'],
    inputPolicy: { mode: 'auto' },
    // Sends text to AI: never previews; the host confirms before sending.
    policy: { effect: 'external-write' },
    params: [{
      key: 'maxPoints',
      label: 'param.points',
      type: 'single-select',
      default: '5',
      options: SUMMARY_POINT_LIMITS.map((value) => ({ value: String(value), label: `points.${value}` })),
    }],
    // Quick Editor output would replace the draft; the summary is a Global Launcher command.
    surfaces: { launcher: { surfaces: ['global-launcher'] } },
    async run(ctx) {
      const text = ctx.input.text
      if (!text.trim()) return ctx.output.error(ctx.t('error.input'))
      const maxPoints = Number(ctx.params.maxPoints) as SummaryPointLimit
      const approval = await ctx.aiSend.request({
        commandId: 'summarize',
        label: ctx.t('tool.title'),
        text,
        preflight: { capabilities: ['text.generate'], inputModalities: ['text'] },
      })
      // Cancelled or unavailable: the host has already shown why.
      if (!approval?.selection.providerId || !approval.selection.agentId) return ctx.output.error(ctx.t('error.unavailable'))
      const selection = { providerId: approval.selection.providerId, agentId: approval.selection.agentId }
      try {
        return ctx.output.text(await streamSummary(ctx.ai, text, maxPoints, selection, ctx.signal, () => {}))
      } catch (error) {
        const code = error instanceof SummaryError ? error.code : 'provider'
        return ctx.output.error(ctx.t(`error.${code}`))
      }
    },
  }],
})
