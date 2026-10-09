/**
 * First-party Custom Commands — named shell lines with L2 confirmation.
 * Requires shell.run (L3); never auto-granted.
 */

import { definePlugin, type PluginToolContribution } from '@hiven/plugin'
import {
  DEFAULT_USER_COMMANDS_SETTINGS,
  enabledUserCommands,
  normalizeUserCommandsSettings,
  type UserCommandEntry,
  type UserCommandsSettings,
} from './model'

function buildCommandTools(settings: UserCommandsSettings): PluginToolContribution<UserCommandsSettings>[] {
  return enabledUserCommands(settings).map((entry: UserCommandEntry): PluginToolContribution<UserCommandsSettings> => ({
    id: 'user-commands.run.' + entry.id,
    title: entry.title,
    subtitle: 'tool.subtitle',
    icon: 'Terminal',
    aliases: [
      entry.title,
      ...(entry.aliases ?? []),
      'shell',
      'cmd',
      '自定义命令',
      '脚本',
    ].filter(Boolean),
    requireParamSelection: false,
    async run(ctx) {
      const command = entry.command.trim()
      if (!command) return ctx.output.error(ctx.t('error.empty'))

      const summary = command.length > 120 ? command.slice(0, 117) + '…' : command
      const confirmTitle = ctx.t('confirm.title')
      const confirmSubtitle = ctx.t('confirm.subtitle', { command: summary })
      const runLabel = ctx.t('confirm.run')
      const cancelLabel = ctx.t('confirm.cancel')

      return ctx.output.choices([
        {
          id: 'confirm-run-' + entry.id,
          title: runLabel,
          titleI18n: { en: runLabel, zh: runLabel },
          subtitle: confirmSubtitle,
          subtitleI18n: { en: confirmSubtitle, zh: confirmSubtitle },
          icon: 'Terminal',
          tone: 'danger',
          primaryAction: async () => {
            try {
              const result = await ctx.shell.run({
                command,
                cwd: entry.cwd?.trim() || undefined,
                timeoutMs: entry.timeoutMs ?? 15_000,
              })
              const stdout = (result.stdout ?? '').trim()
              const stderr = (result.stderr ?? '').trim()
              const code = result.exitCode ?? (result.timedOut ? -1 : 0)
              if (result.timedOut || code !== 0) {
                const msg = ctx.t('result.fail', {
                  code: String(code),
                  stderr: stderr || stdout || ctx.t(result.timedOut ? 'result.timedOut' : 'result.failedFallback'),
                })
                return { ok: false as const, message: msg }
              }
              const msg = ctx.t('result.ok', {
                code: String(code),
                  stdout: stdout || ctx.t('result.noOutput'),
              })
              // Show output as a copyable result by writing via secondary path:
              // return ok and let host toast; also copy stdout when non-empty.
              if (stdout) {
                try {
                  await ctx.api.copyText(stdout)
                } catch {
                  // ignore copy failures
                }
              }
              return { ok: true as const, message: msg }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (/permission|shell\.run|not granted/i.test(message)) {
                return { ok: false as const, message: ctx.t('error.permission') }
              }
              return {
                ok: false as const,
                message: ctx.t('error.shell', { message }),
              }
            }
          },
        },
        {
          id: 'cancel-run-' + entry.id,
          title: cancelLabel,
          titleI18n: { en: cancelLabel, zh: cancelLabel },
          subtitle: confirmTitle,
          icon: 'X',
          primaryAction: async () => ({ ok: true as const }),
        },
      ])
    },
    surfaces: { launcher: { surfaces: ['global-launcher'] }, panel: false },
  }))
}

export default definePlugin<UserCommandsSettings>({
  settings: {
    title: 'settings.title',
    titleI18n: { zh: '自定义命令' },
    version: 1,
    defaultValue: DEFAULT_USER_COMMANDS_SETTINGS,
    migrate: (raw) => normalizeUserCommandsSettings(raw),
    schema: {
      sections: [
        {
          id: 'general',
          title: 'General',
          titleI18n: { zh: '通用' },
          fields: [
            {
              kind: 'switch',
              key: 'enabled',
              icon: 'Power',
              label: 'settings.enabled',
              labelI18n: { zh: '启用自定义命令' },
              description: 'settings.enabled.desc',
              descriptionI18n: { zh: '仅控制命令是否出现在 Launcher，启用不代表已获得执行权限。' },
            },
          ],
        },
        {
          id: 'commands',
          title: 'Commands',
          titleI18n: { zh: '命令' },
          fields: [
            {
              kind: 'object-list',
              key: 'commands',
              label: 'settings.list',
              labelI18n: { zh: '命令列表' },
              itemTitleKey: 'title',
              addLabel: 'settings.add',
              addLabelI18n: { zh: '添加命令' },
              itemLabel: 'settings.item',
              itemLabelI18n: { zh: '命令' },
              emptyText: 'settings.empty',
              emptyTextI18n: { zh: '还没有自定义命令。' },
              itemDefaults: {
                id: 'cmd-new',
                title: 'New command',
                command: 'echo hello',
                cwd: '',
                timeoutMs: 15000,
                aliases: [],
                enabled: true,
                requireConfirm: true,
              },
              fields: [
                {
                  kind: 'text',
                  key: 'title',
                  label: 'field.title',
                  labelI18n: { zh: '名称' },
                },
                {
                  kind: 'textarea',
                  key: 'command',
                  label: 'field.command',
                  labelI18n: { zh: 'Shell 命令' },
                  description: 'field.command.desc',
                  descriptionI18n: {
                    zh: '每次运行都需确认，并且需要命令执行权限（shell.run）；授权状态见插件权限。',
                  },
                },
                {
                  kind: 'text',
                  key: 'cwd',
                  label: 'field.cwd',
                  labelI18n: { zh: '工作目录（可选）' },
                },
                {
                  kind: 'number',
                  key: 'timeoutMs',
                  label: 'field.timeout',
                  labelI18n: { zh: '超时（毫秒）' },
                },
                {
                  kind: 'string-list',
                  key: 'aliases',
                  label: 'field.aliases',
                  labelI18n: { zh: '别名' },
                },
                {
                  kind: 'switch',
                  key: 'enabled',
                  label: 'field.enabled',
                  labelI18n: { zh: '启用' },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  tools: [],
  toolsFor(settings) {
    return buildCommandTools(normalizeUserCommandsSettings(settings))
  },
})

export {
  DEFAULT_USER_COMMANDS_SETTINGS,
  normalizeUserCommandsSettings,
  enabledUserCommands,
} from './model'
