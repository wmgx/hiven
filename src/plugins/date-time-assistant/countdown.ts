import type { LauncherExecuteResult, LauncherItemContribution, PluginLauncherApi } from '@hiven/plugin'
type Translate = (key: string, params?: Record<string, string | number>) => string

/** Explicit intent only. Relative time answers such as “10分钟后” stay unchanged. */
export function parseCountdown(query: string): number | null {
  const text = query.trim()
  const match = text.match(/^(\d+)\s*(秒|分钟|小时)\s*倒计时$/)
    ?? text.match(/^countdown\s+(\d+)\s*(seconds?|minutes?|hours?)$/i)
  if (!match) return null
  const factor = /^(秒|seconds?)$/i.test(match[2]) ? 1 : /^(分钟|minutes?)$/i.test(match[2]) ? 60 : 3600
  const seconds = Number(match[1]) * factor
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 0
}
async function run(api: PluginLauncherApi, t: Translate, seconds?: number): Promise<LauncherExecuteResult> {
  if (!api.shortCountdown) return { ok: false, message: t('countdown.unavailable') }
  try {
    let state = await api.shortCountdown({ action: 'status' })
    if (!state.supported) return { ok: false, message: t('countdown.unavailable') }
    if (state.storageError) return { ok: false, message: t('countdown.storage') }
    if (seconds !== undefined) state = await api.shortCountdown({ action: 'start', seconds })
    if (state.started) return { ok: true }
    const record = state.record
    const title = record?.phase === 'running' ? t('countdown.remaining', { seconds: state.remainingSeconds }) : t(`countdown.${record?.phase ?? 'empty'}`)
    return { ok: true, output: { replaceCurrent: true, choices: [
      { id: 'countdown-refresh', title, subtitle: seconds !== undefined && record?.phase === 'running' ? t('countdown.exists') : t('countdown.refresh'), primaryAction: () => run(api, t) },
      ...(record?.phase === 'running' ? [{ id: 'countdown-cancel', title: t('countdown.cancel'), subtitle: t('countdown.cancelInfo'), primaryAction: async (): Promise<LauncherExecuteResult> => {
        try { await api.shortCountdown!({ action: 'cancel', id: record.id }); return run(api, t) }
        catch { return { ok: false, message: t('countdown.storage') } }
      } }] : []),
      { id: 'countdown-done', title: t('countdown.done'), primaryAction: () => ({ ok: true }) },
    ] } }
  } catch { return { ok: false, message: t('countdown.failed') } }
}
export function countdownStatusItem(): LauncherItemContribution {
  return { id: 'countdown-status', display: { title: 'countdown.title', subtitle: 'countdown.statusInfo', icon: 'Clock', aliases: ['countdown', '倒计时'] }, surfaces: ['global-launcher'], behavior: { type: 'perform' }, execute: ctx => run(ctx.api, ctx.t) }
}
export function countdownStartItem(seconds: number, t: Translate): LauncherItemContribution {
  return { id: 'countdown-start', display: { title: seconds ? t('countdown.start', { seconds }) : t('countdown.range'), subtitle: t('countdown.boundary'), icon: 'Clock' }, surfaces: ['global-launcher'], behavior: { type: 'perform' }, directAnswer: true, execute: ctx => seconds ? run(ctx.api, ctx.t, seconds) : { ok: false, message: t('countdown.range') } }
}
