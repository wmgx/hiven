import { definePlugin, type LauncherDynamicContext, type LauncherItemContribution } from '@hiven/plugin'
import en from './locales/en.json'
import zh from './locales/zh.json'

import { CurrencySurface } from './CurrencySurface'
import { convert, defaults, firstTarget, formatConversion, getRates, HISTORY_KEY, loadTargets, remember, retainedHistory, type HistoryEntry, type Settings } from './core'
import { keyword, parseConversion } from './parse'

export default definePlugin<Settings>({
  settings: {
    title: en.title,
    titleI18n: { zh: zh.title },
    version: 1,
    defaultValue: defaults,
    schema: { sections: [{
      id: 'history',
      title: en.history,
      titleI18n: { zh: zh.history },
      fields: [
        { kind: 'number', key: 'retentionDays', label: en.retentionDays, labelI18n: { zh: zh.retentionDays }, min: 1, max: 365, step: 1 },
        { kind: 'number', key: 'maxEntries', label: en.maxEntries, labelI18n: { zh: zh.maxEntries }, min: 1, max: 100, step: 1 },
      ],
    }] },
  },
  ui: {
    surfaces: [{
      id: 'main',
      kind: 'custom-view',
      title: en.title,
      titleI18n: { zh: zh.title },
      icon: 'Calculator',
      aliases: ['cur', 'currency', '汇率', '换汇'],
      component: CurrencySurface,
      entry: { launcher: { surfaces: ['global-launcher'] } },
      shell: { mode: 'command', size: 'small', inlineHeight: 420, closeOnBlur: true },
    }],
  },
  launcher: {
    async dynamicItems(ctx: LauncherDynamicContext): Promise<LauncherItemContribution[]> {
      if (ctx.surfaceId !== 'global-launcher' || ctx.signal?.aborted) return []
      const query = ctx.query.normalize('NFKC').trim()
      const historyOnly = /^(?:cur(?:rency)? history|汇率历史|换算历史)$/i.test(query)
      const prefix = query.match(keyword)?.[0]
      const input = query.slice(prefix?.length ?? 0).trim()
      // Without the keyword, ambiguous lowercase words ("10 all") need an explicit target.
      const parsed = parseConversion(input, !prefix)
      const item = {
        id: 'currency-conversion',
        behavior: { type: 'perform' },
        surfaces: ['global-launcher'],
        directAnswer: true,
      } as const satisfies Pick<LauncherItemContribution, 'id' | 'behavior' | 'surfaces' | 'directAnswer'>
      if (!parsed) {
        if (historyOnly) {
          const history = await ctx.storage.kv.get<HistoryEntry[]>(HISTORY_KEY).catch(() => undefined)
          if (ctx.signal?.aborted) return []
          const entries = retainedHistory(history ?? [], ctx.settings, Date.now())
          const historyRows = entries.map((entry, index): LauncherItemContribution => {
            const { title, subtitle, icon, text } = formatConversion(entry, ctx)
            return {
              ...item, id: `currency-history-${index}`, display: { title, subtitle, icon },
              async execute(execution) {
                await execution.api.copyText(text)
                return { ok: true }
              },
            }
          })
          if (historyRows.length) return historyRows
          const empty = ctx.t('historyEmpty')
          return [{ ...item, display: { title: empty, icon: 'Calculator' }, execute: () => ({ ok: false, message: empty }) }]
        }
        if (!prefix || !input) return []
        const hint = ctx.t('hint')
        return [{ ...item, display: { title: hint, icon: 'Calculator' }, execute: () => ({ ok: false, message: hint }) }]
      }

      const { amount, from } = parsed
      const targets = parsed.targets ?? [firstTarget(await loadTargets(ctx.storage), from)]
      const request = getRates(ctx.network)
      // Leave time for the host to publish the rows before its dynamic item deadline.
      let timer: number | undefined
      const rates = await Promise.race([
        request,
        new Promise<undefined>((resolve) => { timer = window.setTimeout(resolve, 650) }),
      ]).finally(() => window.clearTimeout(timer))
      if (ctx.signal?.aborted) return []
      return targets.map((to): LauncherItemContribution => {
        const conversion = convert(rates, amount, from, to)
        const preview = conversion && formatConversion(conversion, ctx)
        return {
          ...item,
          id: targets.length > 1 ? `currency-conversion-${to}` : item.id,
          display: {
            title: preview?.title ?? ctx.t('lookup', { amount, from, to }),
            subtitle: preview?.subtitle,
            icon: 'Calculator',
          },
          executeWithParams(execution) {
            execution.api.openSurface('main', { initialText: input })
            return { ok: true, keepOpen: true }
          },
          async execute(execution) {
            const latest = rates ?? await getRates(ctx.network)
            const converted = conversion ?? convert(latest, amount, from, to)
            if (execution.signal?.aborted) return { ok: true }
            if (!converted) return { ok: false, message: latest ? ctx.t('unsupported', { from, to }) : ctx.t('unavailable') }
            await execution.api.copyText(formatConversion(converted, execution).text)
            try {
              await remember(execution.storage, { ...converted, savedAt: Date.now() }, execution.settings)
            } catch {
              execution.api.showMessage(execution.t('historyFailed'), 'warning')
            }
            return { ok: true }
          },
        }
      })
    },
  },
})
