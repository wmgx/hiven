/**
 * L2 tools: status / login / docs search / calendar agenda & search.
 * Kept out of index.tsx so the entry only assembles contributions.
 */

import type { PluginToolContribution } from '@hiven/plugin'
import { detectLarkCli } from './cli/detect'
import { completeLogin, getAuthStatus, startLogin } from './domains/auth'
import {
  fetchAgenda,
  mapEventsToRows,
  searchEvents,
} from './domains/calendar'
import { mapSearchResultsToTargets, searchDocs } from './domains/docs'
import { getFeishuRuntime } from './runtime'
import type { FeishuSettings } from './settings/model'
import { DEFAULT_FEISHU_SETTINGS } from './settings/model'

function resolveSettings(ctxSettings: unknown): FeishuSettings {
  const runtime = getFeishuRuntime()
  return {
    ...DEFAULT_FEISHU_SETTINGS,
    ...runtime.settings,
    ...(ctxSettings as FeishuSettings | undefined),
  }
}

async function openRuntimeUrl(
  url: string,
  fallback: (url: string) => Promise<void>,
): Promise<void> {
  const runtime = getFeishuRuntime()
  if (runtime.openUrl) {
    await runtime.openUrl(url)
    return
  }
  await fallback(url)
}

export const feishuTools: PluginToolContribution<FeishuSettings>[] = [
  {
    id: 'feishu.status',
    title: 'tool.status.title',
    subtitle: 'tool.status.subtitle',
    icon: 'Activity',
    aliases: ['飞书', 'lark', 'feishu', '状态', 'status', '飞书状态'],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const detect = await detectLarkCli({
        shell,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!detect.installed) {
        const lines = [ctx.t('error.notInstalled')]
        if (detect.summary) lines.push(detect.summary)
        return ctx.output.text(lines.join('\n'))
      }

      const auth = await getAuthStatus(shell, settings.binaryPath || undefined)
      const statusLine = auth.loggedIn
        ? ctx.t('status.ok') + ': ' + auth.summary
        : ctx.t('error.notLoggedIn') + ': ' + auth.summary
      return ctx.output.text([detect.summary ?? 'lark-cli ok', statusLine].join('\n'))
    },
  },
  {
    id: 'feishu.login',
    title: 'tool.login.title',
    subtitle: 'tool.login.subtitle',
    icon: 'LogIn',
    aliases: ['飞书登录', 'lark login', 'feishu login', '登录飞书'],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const started = await startLogin(shell, settings.binaryPath || undefined)
      if (!started.ok) {
        return ctx.output.error(started.message || ctx.t('login.failed'))
      }

      if (started.verificationUrl) {
        try {
          await openRuntimeUrl(started.verificationUrl, (url) => ctx.api.openUrl(url))
        } catch {
          // still report URL in text
        }
      }

      if (started.deviceCode) {
        void completeLogin(shell, {
          binaryPath: settings.binaryPath || undefined,
          deviceCode: started.deviceCode,
        })
      }

      const parts = [ctx.t('login.started')]
      if (started.verificationUrl) parts.push(started.verificationUrl)
      if (started.userCode) parts.push('code: ' + started.userCode)
      return ctx.output.text(parts.join('\n'))
    },
  },
  {
    id: 'feishu.docs-search',
    title: 'tool.docsSearch.title',
    subtitle: 'tool.docsSearch.subtitle',
    icon: 'FileSearch',
    aliases: ['飞书文档', 'docs', 'lark docs', 'feishu docs', '搜文档'],
    requireParamSelection: true,
    params: [
      {
        key: 'query',
        label: 'param.query.label',
        type: 'text',
        required: true,
        hint: 'param.query.hint',
      },
    ],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const query = String(ctx.params.query ?? ctx.input?.text ?? '').trim()
      if (!query) {
        return ctx.output.error(ctx.t('param.query.hint'))
      }

      const search = await searchDocs({
        shell,
        query,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!search.ok) {
        return ctx.output.error(search.message || ctx.t('error.searchFailed'))
      }

      const targets = mapSearchResultsToTargets(search.results)
      if (targets.length === 0) {
        return ctx.output.text(ctx.t('error.noResults'))
      }

      return ctx.output.choices(
        targets.map((target) => ({
          id: target.id,
          title: target.title,
          subtitle: target.subtitle ?? target.meta.url,
          icon: target.icon ?? 'FileText',
          primaryAction: async () => {
            try {
              await openRuntimeUrl(target.meta.url, (url) => ctx.api.openUrl(url))
              return { ok: true as const }
            } catch (error) {
              return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }
            }
          },
        })),
      )
    },
  },
  {
    id: 'feishu.calendar-agenda',
    title: 'tool.agenda.title',
    subtitle: 'tool.agenda.subtitle',
    icon: 'Calendar',
    aliases: ['飞书日程', '今日议程', 'agenda', 'calendar', '日程', '今天日程'],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const agenda = await fetchAgenda({
        shell,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!agenda.ok) {
        const parts = [agenda.message || ctx.t('error.agendaFailed')]
        if (agenda.hint) parts.push(agenda.hint)
        return ctx.output.error(parts.join('\n'))
      }

      const rows = mapEventsToRows(agenda.events)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.agendaEmpty'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.calendar:event:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: 'Calendar',
          primaryAction: async () => {
            try {
              if (row.url) {
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url))
                return { ok: true as const }
              }
              await ctx.api.copyText(row.summaryText)
              return { ok: true as const, message: ctx.t('action.copied') }
            } catch (error) {
              return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }
            }
          },
        })),
      )
    },
  },
  {
    id: 'feishu.calendar-search',
    title: 'tool.calendarSearch.title',
    subtitle: 'tool.calendarSearch.subtitle',
    icon: 'CalendarSearch',
    aliases: ['搜日程', '搜索日程', 'search event', 'calendar search', '飞书搜日程'],
    requireParamSelection: true,
    params: [
      {
        key: 'query',
        label: 'param.eventQuery.label',
        type: 'text',
        required: true,
        hint: 'param.eventQuery.hint',
      },
    ],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const query = String(ctx.params.query ?? ctx.input?.text ?? '').trim()
      if (!query) {
        return ctx.output.error(ctx.t('param.eventQuery.hint'))
      }

      const search = await searchEvents({
        shell,
        query,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!search.ok) {
        const parts = [search.message || ctx.t('error.calendarSearchFailed')]
        if (search.hint) parts.push(search.hint)
        return ctx.output.error(parts.join('\n'))
      }

      const rows = mapEventsToRows(search.events)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.agendaEmpty'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.calendar:search:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: 'Calendar',
          primaryAction: async () => {
            try {
              if (row.url) {
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url))
                return { ok: true as const }
              }
              await ctx.api.copyText(row.summaryText)
              return { ok: true as const, message: ctx.t('action.copied') }
            } catch (error) {
              return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }
            }
          },
        })),
      )
    },
  },
]
