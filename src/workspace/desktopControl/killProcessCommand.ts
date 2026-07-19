/**
 * Kill Process as a first-level host command with collect-input second level
 * (same UX as web-open: select command → type to filter suggestions → pick row → L2 confirm).
 */

import type { Locale } from '../../i18n'
import type {
  LauncherExecuteResult,
  LauncherItem,
  LauncherOutput,
  LauncherResultChoice,
  LauncherSuggestContext,
} from '../launcher/types'
import { auditL2Action } from './audit'
import {
  clearDesktopProcessListCache,
  listDesktopProcessesCached,
  type DesktopProcess,
} from './processes'

const QUERY_PROCESS_LIMIT = 40

function processBaseName(name: string): string {
  const parts = name.split(/[/\\]/)
  return parts[parts.length - 1] || name
}

function formatMemory(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 10) return `${Math.round(mb)} MB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function formatCpu(cpu: number | undefined): string {
  if (cpu == null || !Number.isFinite(cpu)) return '—'
  return `${cpu.toFixed(1)}%`
}

/** Heuristic app icon for known apps; falls back to Cpu. */
function processIcon(name: string): string {
  const base = processBaseName(name).toLowerCase()
  // Common macOS app process names → prefer generic brand icons when no app-icon id.
  if (base.includes('chrome') || base.includes('helper')) return 'Globe'
  if (base.includes('edge')) return 'Globe'
  if (base.includes('safari')) return 'Globe'
  if (base.includes('code') || base.includes('cursor')) return 'Code'
  if (base.includes('node') || base.includes('npm')) return 'Terminal'
  if (base.includes('python') || base.includes('ruby')) return 'Terminal'
  if (base.includes('lark') || base.includes('feishu') || base.includes('飞书')) return 'MessageSquare'
  return 'Cpu'
}

function processSubtitle(proc: DesktopProcess): string {
  const cpu = formatCpu(proc.cpuPercent)
  const mem = formatMemory(proc.memoryBytes)
  return `CPU ${cpu} · MEM ${mem} · pid ${proc.pid}`
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function terminateDesktopProcess(pid: number, force = false): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Process terminate is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('terminate_desktop_process', { pid, force })
}

function buildTerminateConfirmResult(proc: DesktopProcess): LauncherExecuteResult {
  const base = processBaseName(proc.name)
  const summary = `${base} · ${processSubtitle(proc)}`
  return {
    ok: true,
    output: {
      choices: [
        {
          id: 'confirm-terminate-process',
          title: 'Confirm terminate',
          titleI18n: { en: 'Confirm terminate', zh: '确认结束' },
          subtitle: summary,
          subtitleI18n: { en: summary, zh: summary },
          icon: processIcon(proc.name),
          primaryAction: async () => {
            try {
              auditL2Action({ action: 'process.terminate', targetSummary: summary })
              await terminateDesktopProcess(proc.pid, false)
              clearDesktopProcessListCache()
              return { ok: true as const }
            } catch (error) {
              return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }
            }
          },
        },
        {
          id: 'cancel-terminate-process',
          title: 'Cancel',
          titleI18n: { en: 'Cancel', zh: '取消' },
          primaryAction: async () => ({ ok: true as const, keepOpen: true as const }),
        },
      ],
    },
  }
}

function processToChoice(proc: DesktopProcess): LauncherResultChoice {
  const base = processBaseName(proc.name)
  const subtitle = processSubtitle(proc)
  return {
    id: `process:${proc.pid}`,
    title: base,
    titleI18n: { en: base, zh: base },
    subtitle,
    subtitleI18n: { en: subtitle, zh: subtitle },
    icon: processIcon(proc.name),
    primaryAction: async () => buildTerminateConfirmResult(proc),
  }
}

async function loadProcessChoices(filter: string): Promise<LauncherResultChoice[]> {
  // Bare second-level input → list all; otherwise filter by name.
  const listQuery = filter.trim() || '*'
  const list = await listDesktopProcessesCached(listQuery)
  return list.slice(0, QUERY_PROCESS_LIMIT).map(processToChoice)
}

/**
 * Static first-level host command: "Kill Process".
 * Second level uses collect-input + suggest (same pattern as web-open history).
 */
export function getKillProcessHostItem(): LauncherItem {
  return {
    systemKey: 'host:process:kill-command',
    kind: 'host',
    display: {
      title: 'Kill Process',
      titleI18n: { en: 'Kill Process', zh: '结束进程' },
      subtitle: 'Select a process to terminate',
      subtitleI18n: {
        en: 'Select a process to terminate',
        zh: '选择要结束的进程',
      },
      icon: 'Cpu',
      aliases: [
        'kill',
        'kill process',
        'terminate',
        'end process',
        '杀',
        '结束',
        '结束进程',
        '杀进程',
        '进程',
        'process',
      ],
      kindLabel: 'Process',
      kindLabelI18n: { en: 'Process', zh: '进程' },
    },
    behavior: {
      type: 'collect-input',
      input: {
        placeholder: 'Filter processes…',
        placeholderI18n: {
          en: 'Filter processes…',
          zh: '过滤进程名…',
        },
        allowEmptyInput: true,
        emptyInputMessage: 'Select a process from the list',
        emptyInputMessageI18n: {
          en: 'Select a process from the list',
          zh: '请从列表中选择进程',
        },
      },
    },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-processes'],
    recordUsage: true,
    // Stable id for usage learning of the command itself.
    suggest: async (ctx: LauncherSuggestContext) => {
      const choices = await loadProcessChoices(ctx.inputText)
      if (choices.length === 0) {
        return {
          choices: [
            {
              id: 'process-empty',
              title: ctx.locale === 'zh' ? '未找到进程' : 'No processes found',
              subtitle: ctx.inputText.trim() || undefined,
              primaryAction: async () => ({ ok: true as const, keepOpen: true as const }),
            },
          ],
        } satisfies LauncherOutput
      }
      return { choices }
    },
    execute: async (ctx) => {
      // Free-text submit without picking a row: try exact/unique name match → L2 confirm.
      const filter = (ctx.input?.text ?? '').trim()
      const choices = await loadProcessChoices(filter)
      if (choices.length === 1) {
        return choices[0].primaryAction()
      }
      if (choices.length === 0) {
        return {
          ok: false as const,
          message:
            ctx.locale === 'zh'
              ? '未找到匹配进程，请从列表中选择'
              : 'No matching process — pick one from the list',
        }
      }
      // Multiple matches: stay on suggest list (caller should select).
      return {
        ok: false as const,
        message:
          ctx.locale === 'zh'
            ? '多个匹配，请用方向键选择进程后回车'
            : 'Multiple matches — highlight a process and press Enter',
      }
    },
  }
}

/** @deprecated Prefer getKillProcessHostItem; kept for tests that probe process mode helpers. */
export function isKillProcessCommandKey(systemKey: string): boolean {
  return systemKey === 'host:process:kill-command'
}

export type { Locale }
