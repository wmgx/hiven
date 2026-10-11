import { definePlugin, type LauncherDynamicContext, type LauncherItemContribution } from '@hiven/plugin'
import { parsePermissionQuery, type PermissionGroup } from './core'

export default definePlugin({
  launcher: {
    dynamicItems(ctx: LauncherDynamicContext): LauncherItemContribution[] {
      const parsed = parsePermissionQuery(ctx.query ?? '')
      if (!parsed) return []
      if (!parsed.ok) return [{
        id: 'permissions-error', display: { title: ctx.t(`error.${parsed.error}`), subtitle: ctx.t('help'), icon: 'Lock' },
        behavior: { type: 'perform' }, surfaces: ['global-launcher'], directAnswer: true,
        execute() { return { ok: false, message: ctx.t(`error.${parsed.error}`) } },
      }]
      const value = parsed.value
      const permissions = (part: PermissionGroup) => {
        const rights = [part.read && ctx.t('read'), part.write && ctx.t('write'), part.execute && ctx.t('execute')].filter(Boolean)
        return rights.length ? rights.join('/') : ctx.t('none')
      }
      const groups = (['owner', 'group', 'others'] as const).map((name) => `${ctx.t(name)}: ${permissions(value[name])}`)
      const compactGroups = (['owner', 'group', 'others'] as const).map((name) => `${ctx.t(name)}: ${value[name].symbolic}`)
      const special = (['setuid', 'setgid', 'sticky'] as const).filter((name) => value[name])
      const title = `${value.octal} ↔ ${value.symbolic}${special.length ? ` · ${special.join(' + ')}` : ''}`
      const copied = [title, ...groups,
        ctx.t('meaning'),
        ...special.map((name) => ctx.t(`special.${name}`)),
        ...(special.length ? [ctx.t('special.case')] : []),
        ctx.t('localOnly'),
      ].join('\n')
      return [{
        id: 'permissions-answer', display: { title, subtitle: `${compactGroups.join(' · ')} · ${ctx.t('copy')}`, icon: 'Lock' },
        behavior: { type: 'perform' }, surfaces: ['global-launcher'], directAnswer: true,
        async execute(execution) {
          await execution.api.copyText(copied)
          return { ok: true, output: { choices: [{ id: 'copy', title: copied, primaryAction: async () => { await execution.api.copyText(copied) } }] } }
        },
      }]
    },
  },
})
