/**
 * L2 tools: status / login / docs search / calendar agenda & search.
 * Kept out of index.tsx so the entry only assembles contributions.
 */

import type { PluginToolContribution } from '@hiven/plugin'
import { detectLarkCli } from './cli/detect'
import { presentFeishuCliFailure } from './cli/formatError'
import { completeLogin, getAuthStatus, startLogin } from './domains/auth'
import {
  fetchAgenda,
  mapEventsToRows,
  searchEvents,
} from './domains/calendar'
import { mapUsersToRows, searchUsersWithAvatars, sortUsersByIntersection } from './domains/contact'
import { fetchDocContent, mapSearchResultsToTargets, searchDocs } from './domains/docs'
import { listRecentChats, mapChatsToRows, searchChats } from './domains/im'
import { mapMessagesToRows, searchMessages } from './domains/messages'
import { mapMinutesToRows, searchMinutes } from './domains/minutes'
import { listMyTasks, mapTasksToRows } from './domains/tasks'
import { openFeishuTarget } from './domains/windowFocus'
import { createCalendarEvent, createDoc, createSheet, deriveTitleFromContent, sendMessage } from './domains/write'
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
  titleHint?: string,
): Promise<void> {
  const runtime = getFeishuRuntime()
  const openUrl = runtime.openUrl ?? fallback
  await openFeishuTarget({
    shell: runtime.shell,
    openUrl,
    url,
    titleHint,
    preferWindowFocus: runtime.settings.preferWindowFocus !== false,
  })
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
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: search,
          fallbackKey: 'error.searchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
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
              await openRuntimeUrl(
                target.meta.url,
                (url) => ctx.api.openUrl(url),
                target.title,
              )
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
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: agenda,
          fallbackKey: 'error.agendaFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
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
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url), row.title)
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
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: search,
          fallbackKey: 'error.calendarSearchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
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
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url), row.title)
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
    id: 'feishu.chat-search',
    title: 'tool.chatSearch.title',
    subtitle: 'tool.chatSearch.subtitle',
    icon: 'MessagesSquare',
    aliases: ['搜群', '搜会话', 'chat search', '飞书群', '找群'],
    requireParamSelection: true,
    params: [
      {
        key: 'query',
        label: 'param.chatQuery.label',
        type: 'text',
        required: true,
        hint: 'param.chatQuery.hint',
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
        return ctx.output.error(ctx.t('param.chatQuery.hint'))
      }

      const search = await searchChats({
        shell,
        query,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!search.ok) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: search,
          fallbackKey: 'error.chatSearchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      const rows = mapChatsToRows(search.chats)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.noChats'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.im:chat:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: row.icon || 'MessagesSquare',
          primaryAction: async () => {
            try {
              if (row.openUrl) {
                await openRuntimeUrl(row.openUrl, (url) => ctx.api.openUrl(url), row.title)
                return { ok: true as const, message: ctx.t('action.openedChat') }
              }
              await ctx.api.copyText(row.summaryText)
              return { ok: true as const, message: ctx.t('action.copiedChatId') }
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
    id: 'feishu.chat-list',
    title: 'tool.chatList.title',
    subtitle: 'tool.chatList.subtitle',
    icon: 'MessageCircle',
    aliases: ['最近会话', '会话列表', 'recent chats', 'chat list', '我的群'],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const listed = await listRecentChats({
        shell,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!listed.ok) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: listed,
          fallbackKey: 'error.chatListFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      const rows = mapChatsToRows(listed.chats)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.noChats'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.im:recent:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: row.icon || 'MessageCircle',
          primaryAction: async () => {
            try {
              if (row.openUrl) {
                await openRuntimeUrl(row.openUrl, (url) => ctx.api.openUrl(url), row.title)
                return { ok: true as const, message: ctx.t('action.openedChat') }
              }
              await ctx.api.copyText(row.summaryText)
              return { ok: true as const, message: ctx.t('action.copiedChatId') }
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
    id: 'feishu.contact-search',
    title: 'tool.contactSearch.title',
    subtitle: 'tool.contactSearch.subtitle',
    icon: 'UserSearch',
    aliases: ['找人', '搜人', '联系人', 'contact', 'search user', '飞书找人'],
    requireParamSelection: true,
    params: [
      {
        key: 'query',
        label: 'param.userQuery.label',
        type: 'text',
        required: true,
        hint: 'param.userQuery.hint',
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
        return ctx.output.error(ctx.t('param.userQuery.hint'))
      }

      const search = await searchUsersWithAvatars({
        shell,
        query,
        binaryPath: settings.binaryPath || undefined,
        // L1 always filters; L2「找人」honors settings.contactSearchOnlyChatted.
        onlyChatted: settings.contactSearchOnlyChatted === true,
      })
      if (!search.ok) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: search,
          fallbackKey: 'error.contactSearchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      // When not restricted, still rank chatted contacts first.
      const rows = sortUsersByIntersection(mapUsersToRows(search.users))
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.noUsers'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.contact:user:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: row.icon || 'User',
          primaryAction: async () => {
            try {
              if (row.openUrl) {
                await openRuntimeUrl(row.openUrl, (url) => ctx.api.openUrl(url), row.title)
                return { ok: true as const, message: ctx.t('action.openedChat') }
              }
              await ctx.api.copyText(row.summaryText)
              return { ok: true as const, message: ctx.t('action.copiedContact') }
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
    id: 'feishu.send-message',
    title: 'tool.sendMessage.title',
    subtitle: 'tool.sendMessage.subtitle',
    icon: 'Send',
    aliases: ['发消息', 'send message', '飞书发消息'],
    requireParamSelection: true,
    params: [
      {
        key: 'chatId',
        label: 'param.chatId.label',
        type: 'text',
        required: true,
        hint: 'param.chatId.hint',
      },
      {
        key: 'text',
        label: 'param.messageText.label',
        type: 'text',
        required: true,
        hint: 'param.messageText.hint',
      },
    ],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const chatId = String(ctx.params.chatId ?? '').trim()
      const text = String(ctx.params.text ?? ctx.input?.text ?? '').trim()
      if (!chatId || !text) {
        return ctx.output.error(ctx.t('error.writeParams'))
      }

      const preview = text.length > 80 ? text.slice(0, 80) + '…' : text
      // L2 confirmation: no CLI write until user picks Confirm
      return ctx.output.choices([
        {
          id: 'feishu.write:send-confirm',
          title: ctx.t('confirm.sendMessage'),
          subtitle: chatId + ' · ' + preview,
          icon: 'Send',
          primaryAction: async () => {
            const sent = await sendMessage({
              shell,
              binaryPath: settings.binaryPath || undefined,
              chatId,
              text,
              confirmed: true,
            })
            if (!sent.ok) {
              const parts = [sent.message || ctx.t('error.sendFailed')]
              if (sent.hint) parts.push(sent.hint)
              return { ok: false as const, message: parts.join('\n') }
            }
            return { ok: true as const, message: ctx.t('action.sent') }
          },
        },
        {
          id: 'feishu.write:send-cancel',
          title: ctx.t('confirm.cancel'),
          subtitle: ctx.t('confirm.cancelHint'),
          icon: 'X',
          primaryAction: async () => ({ ok: true as const, message: ctx.t('action.cancelled') }),
        },
      ])
    },
  },
  {
    id: 'feishu.create-event',
    title: 'tool.createEvent.title',
    subtitle: 'tool.createEvent.subtitle',
    icon: 'CalendarPlus',
    aliases: ['建日程', '创建日程', 'create event', '飞书建日程'],
    requireParamSelection: true,
    params: [
      {
        key: 'summary',
        label: 'param.eventSummary.label',
        type: 'text',
        required: true,
        hint: 'param.eventSummary.hint',
      },
      {
        key: 'start',
        label: 'param.eventStart.label',
        type: 'text',
        required: true,
        hint: 'param.eventStart.hint',
      },
      {
        key: 'end',
        label: 'param.eventEnd.label',
        type: 'text',
        required: true,
        hint: 'param.eventEnd.hint',
      },
    ],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const summary = String(ctx.params.summary ?? '').trim()
      const start = String(ctx.params.start ?? '').trim()
      const end = String(ctx.params.end ?? '').trim()
      if (!summary || !start || !end) {
        return ctx.output.error(ctx.t('error.writeParams'))
      }

      return ctx.output.choices([
        {
          id: 'feishu.write:event-confirm',
          title: ctx.t('confirm.createEvent'),
          subtitle: summary + ' · ' + start + ' → ' + end,
          icon: 'CalendarPlus',
          primaryAction: async () => {
            const created = await createCalendarEvent({
              shell,
              binaryPath: settings.binaryPath || undefined,
              summary,
              start,
              end,
              confirmed: true,
            })
            if (!created.ok) {
              const parts = [created.message || ctx.t('error.createEventFailed')]
              if (created.hint) parts.push(created.hint)
              return { ok: false as const, message: parts.join('\n') }
            }
            return { ok: true as const, message: ctx.t('action.eventCreated') }
          },
        },
        {
          id: 'feishu.write:event-cancel',
          title: ctx.t('confirm.cancel'),
          subtitle: ctx.t('confirm.cancelHint'),
          icon: 'X',
          primaryAction: async () => ({ ok: true as const, message: ctx.t('action.cancelled') }),
        },
      ])
    },
  },
  {
    id: 'feishu.create-doc',
    title: 'tool.createDoc.title',
    subtitle: 'tool.createDoc.subtitle',
    icon: 'FilePlus',
    aliases: ['建文档', '创建文档', 'create doc', '飞书建文档', '写文档', '空白文档'],
    // No param form: one-tap confirm creates empty doc (or uses selection/input as body).
    requireParamSelection: false,
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      // Prefer explicit param if host ever prefilled; else selection/active text; else empty.
      const content = String(ctx.params.content ?? ctx.input?.text ?? '').trim()
      const title = deriveTitleFromContent(content) || ctx.t('doc.defaultTitle')
      const preview = content
        ? ctx.t('confirm.createDocWithBody', {
            title,
            preview: content.slice(0, 36) + (content.length > 36 ? '…' : ''),
          })
        : ctx.t('confirm.createDocEmpty')

      return ctx.output.choices([
        {
          id: 'feishu.write:doc-confirm',
          title: ctx.t('confirm.createDoc'),
          subtitle: preview,
          icon: 'FilePlus',
          primaryAction: async () => {
            const created = await createDoc({
              shell,
              binaryPath: settings.binaryPath || undefined,
              title,
              content: content || undefined,
              confirmed: true,
            })
            if (!created.ok) {
              return {
                ok: false as const,
                message: created.message || ctx.t('error.createDocFailed'),
              }
            }
            if (created.url) {
              try {
                await openRuntimeUrl(created.url, (url) => ctx.api.openUrl(url))
              } catch {
                // ignore open failure; still report success
              }
            }
            return {
              ok: true as const,
              message: created.url
                ? ctx.t('action.docCreated') + ': ' + created.url
                : ctx.t('action.docCreated'),
            }
          },
        },
        {
          id: 'feishu.write:doc-cancel',
          title: ctx.t('confirm.cancel'),
          subtitle: ctx.t('confirm.cancelHint'),
          icon: 'X',
          primaryAction: async () => ({ ok: true as const, message: ctx.t('action.cancelled') }),
        },
      ])
    },
  },
  {
    id: 'feishu.create-sheet',
    title: 'tool.createSheet.title',
    subtitle: 'tool.createSheet.subtitle',
    icon: 'Sheet',
    aliases: [
      '建表格',
      '创建表格',
      '创建电子表格',
      '建多维表格',
      'create sheet',
      'create spreadsheet',
      'bitable',
      '飞书表格',
    ],
    requireParamSelection: true,
    params: [
      {
        key: 'type',
        label: 'param.sheetType.label',
        type: 'single-select',
        required: true,
        default: 'sheet',
        options: [
          {
            label: 'param.sheetType.sheet',
            value: 'sheet',
            description: 'param.sheetType.sheetDesc',
          },
          {
            label: 'param.sheetType.bitable',
            value: 'bitable',
            description: 'param.sheetType.bitableDesc',
          },
        ],
      },
      {
        key: 'title',
        label: 'param.sheetTitle.label',
        type: 'text',
        required: false,
        hint: 'param.sheetTitle.hint',
      },
    ],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const kindRaw = String(ctx.params.type ?? 'sheet').trim()
      const kind = kindRaw === 'bitable' ? 'bitable' : 'sheet'
      const title =
        String(ctx.params.title ?? '').trim() ||
        (kind === 'bitable' ? ctx.t('sheet.defaultBaseTitle') : ctx.t('sheet.defaultSheetTitle'))

      return ctx.output.choices([
        {
          id: 'feishu.write:sheet-confirm',
          title: ctx.t('confirm.createSheet'),
          subtitle: `${kind === 'bitable' ? ctx.t('param.sheetType.bitable') : ctx.t('param.sheetType.sheet')} · ${title}`,
          icon: kind === 'bitable' ? 'Table2' : 'Sheet',
          primaryAction: async () => {
            const created = await createSheet({
              shell,
              binaryPath: settings.binaryPath || undefined,
              kind,
              title,
              confirmed: true,
            })
            if (!created.ok) {
              return {
                ok: false as const,
                message: created.message || ctx.t('error.createSheetFailed'),
              }
            }
            if (created.url) {
              try {
                await openRuntimeUrl(created.url, (url) => ctx.api.openUrl(url))
              } catch {
                // ignore
              }
            }
            return {
              ok: true as const,
              message: created.url
                ? ctx.t('action.sheetCreated') + ': ' + created.url
                : ctx.t('action.sheetCreated'),
            }
          },
        },
        {
          id: 'feishu.write:sheet-cancel',
          title: ctx.t('confirm.cancel'),
          subtitle: ctx.t('confirm.cancelHint'),
          icon: 'X',
          primaryAction: async () => ({ ok: true as const, message: ctx.t('action.cancelled') }),
        },
      ])
    },
  },
  {
    id: 'feishu.docs-fetch',
    title: 'tool.docsFetch.title',
    subtitle: 'tool.docsFetch.subtitle',
    icon: 'FileDown',
    aliases: ['拉取文档', '文档进编辑器', 'fetch doc', 'docs fetch', '打开文档内容'],
    requireParamSelection: true,
    params: [
      {
        key: 'doc',
        label: 'param.docRef.label',
        type: 'text',
        required: true,
        hint: 'param.docRef.hint',
      },
    ],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const doc = String(ctx.params.doc ?? ctx.input?.text ?? '').trim()
      if (!doc) {
        return ctx.output.error(ctx.t('param.docRef.hint'))
      }

      const fetched = await fetchDocContent({
        shell,
        doc,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!fetched.ok || !fetched.content) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: fetched,
          fallbackKey: 'error.fetchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      const title = fetched.title || ctx.t('tool.docsFetch.title')
      try {
        await ctx.api.createPane({
          text: fetched.content,
          title,
          language: 'markdown',
          focus: true,
        })
        return ctx.output.text(ctx.t('action.openedInEditor') + ': ' + title)
      } catch {
        // Fallback: text result in launcher / clipboard path
        return ctx.output.text(fetched.content)
      }
    },
  },
  {
    id: 'feishu.messages-search',
    title: 'tool.messagesSearch.title',
    subtitle: 'tool.messagesSearch.subtitle',
    icon: 'MessageSquareSearch',
    aliases: ['搜消息', '消息搜索', 'search messages', '飞书消息'],
    requireParamSelection: true,
    params: [
      {
        key: 'query',
        label: 'param.messageQuery.label',
        type: 'text',
        required: true,
        hint: 'param.messageQuery.hint',
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
        return ctx.output.error(ctx.t('param.messageQuery.hint'))
      }

      const search = await searchMessages({
        shell,
        query,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!search.ok) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: search,
          fallbackKey: 'error.messagesSearchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      const rows = mapMessagesToRows(search.messages)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.noMessages'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.im:message:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: 'MessageSquare',
          primaryAction: async () => {
            try {
              if (row.url) {
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url), row.title)
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
    id: 'feishu.my-tasks',
    title: 'tool.myTasks.title',
    subtitle: 'tool.myTasks.subtitle',
    icon: 'ListTodo',
    aliases: ['我的待办', '我的任务', '任务', '待办', 'my tasks', 'todos', 'wode', 'wodedaiban', '飞书待办'],
    surfaces: { launcher: true },
    async run(ctx) {
      const settings = resolveSettings(ctx.settings)
      const shell = getFeishuRuntime().shell
      if (!shell) {
        return ctx.output.error(ctx.t('error.shellMissing'))
      }

      const listed = await listMyTasks({
        shell,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!listed.ok) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: listed,
          fallbackKey: 'error.tasksFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      const rows = mapTasksToRows(listed.tasks)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.noTasks'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.task:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: 'ListTodo',
          primaryAction: async () => {
            try {
              if (row.url) {
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url), row.title)
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
    id: 'feishu.minutes-search',
    title: 'tool.minutesSearch.title',
    subtitle: 'tool.minutesSearch.subtitle',
    icon: 'Mic',
    aliases: ['妙记', '搜妙记', 'minutes', '飞书妙记'],
    requireParamSelection: true,
    params: [
      {
        key: 'query',
        label: 'param.minutesQuery.label',
        type: 'text',
        required: true,
        hint: 'param.minutesQuery.hint',
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
        return ctx.output.error(ctx.t('param.minutesQuery.hint'))
      }

      const search = await searchMinutes({
        shell,
        query,
        binaryPath: settings.binaryPath || undefined,
      })
      if (!search.ok) {
        return await presentFeishuCliFailure({
          t: ctx.t,
          output: ctx.output,
          failure: search,
          fallbackKey: 'error.minutesSearchFailed',
          shell,
          binaryPath: settings.binaryPath || undefined,
          openUrl: (url) => openRuntimeUrl(url, (u) => ctx.api.openUrl(u)),
        })
      }

      const rows = mapMinutesToRows(search.minutes)
      if (rows.length === 0) {
        return ctx.output.text(ctx.t('error.noMinutes'))
      }

      return ctx.output.choices(
        rows.map((row) => ({
          id: `feishu.minutes:${row.id}`,
          title: row.title,
          subtitle: row.subtitle,
          icon: 'Mic',
          primaryAction: async () => {
            try {
              if (row.url) {
                await openRuntimeUrl(row.url, (url) => ctx.api.openUrl(url), row.title)
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
