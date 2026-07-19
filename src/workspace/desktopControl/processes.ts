import type { Locale } from '../../i18n'
import type { LauncherExecuteResult, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { auditL2Action } from './audit'

export type DesktopProcess = {
  pid: number
  name: string
}

const PROCESS_LIST_TTL_MS = 2000
const QUERY_PROCESS_LIMIT = 40

const TERMINATE_PREFIXES = ['杀', '结束', 'kill', 'terminate', 'stop process'] as const

type ProcessListCache = {
  key: string
  fetchedAt: number
  processes: DesktopProcess[]
}

let processListCache: ProcessListCache | null = null

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

/** Strip kill/terminate intent prefixes for process name search. */
export function stripProcessQueryPrefix(query: string): string {
  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()
  for (const prefix of TERMINATE_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}:`) || lower.startsWith(`${prefix}：`)) {
      return trimmed.slice(prefix.length).replace(/^[\s:：]+/, '')
    }
  }
  return trimmed
}

export async function listDesktopProcessesCached(
  query: string,
  options: { force?: boolean } = {},
): Promise<DesktopProcess[]> {
  const q = query.trim()
  // Empty string is invalid for native list; use "*" for process-mode "list all".
  if (!q) return []

  const now = Date.now()
  const key = q.toLowerCase()
  if (
    options.force !== true &&
    processListCache &&
    processListCache.key === key &&
    now - processListCache.fetchedAt < PROCESS_LIST_TTL_MS
  ) {
    return processListCache.processes
  }

  if (!isTauriRuntime()) {
    processListCache = { key, fetchedAt: now, processes: [] }
    return []
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const processes = (await invoke('list_desktop_processes', { query: q })) as DesktopProcess[]
    const list = Array.isArray(processes) ? processes : []
    processListCache = { key, fetchedAt: Date.now(), processes: list }
    return list
  } catch {
    processListCache = { key, fetchedAt: Date.now(), processes: [] }
    return []
  }
}

/** Test helper: reset in-memory TTL cache. */
export function clearDesktopProcessListCache(): void {
  processListCache = null
}

async function terminateDesktopProcess(pid: number, force = false): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Process terminate is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('terminate_desktop_process', { pid, force })
}

function processBaseName(name: string): string {
  const parts = name.split(/[/\\]/)
  return parts[parts.length - 1] || name
}

function buildTerminateConfirmResult(proc: DesktopProcess): LauncherExecuteResult {
  const base = processBaseName(proc.name)
  const summary = `${base} (pid ${proc.pid})`
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
          primaryAction: async () => {
            try {
              auditL2Action({ action: 'process.terminate', targetSummary: summary })
              // Soft terminate by default (SIGTERM). Force kill is non-default / not exposed here.
              await terminateDesktopProcess(proc.pid, false)
              clearDesktopProcessListCache()
              return { ok: true }
            } catch (error) {
              return { ok: false, message: error instanceof Error ? error.message : String(error) }
            }
          },
        },
        {
          id: 'cancel-terminate-process',
          title: 'Cancel',
          titleI18n: { en: 'Cancel', zh: '取消' },
          primaryAction: async () => ({ ok: true }),
        },
      ],
    },
  }
}

function buildTerminateItem(proc: DesktopProcess): LauncherItem {
  const base = processBaseName(proc.name)
  return {
    systemKey: `host:process:terminate:${proc.pid}`,
    kind: 'host',
    display: {
      title: base,
      titleI18n: { en: base, zh: base },
      subtitle: `pid ${proc.pid}`,
      subtitleI18n: { en: `pid ${proc.pid} · Process`, zh: `pid ${proc.pid} · 进程` },
      icon: 'Cpu',
      aliases: ['杀', '结束', 'kill', 'process', '进程', base, proc.name].filter(Boolean),
      kindLabel: 'Process',
      kindLabelI18n: { en: 'Process', zh: '进程' },
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-processes'],
    recordUsage: false,
    execute: async () => buildTerminateConfirmResult(proc),
  }
}

/** True only when the user explicitly entered a kill/terminate intent prefix. */
export function isProcessModeQuery(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  for (const prefix of TERMINATE_PREFIXES) {
    if (
      lower === prefix ||
      lower.startsWith(`${prefix} `) ||
      lower.startsWith(`${prefix}:`) ||
      lower.startsWith(`${prefix}：`)
    ) {
      return true
    }
  }
  return false
}

export async function getHostProcessLauncherDynamicItems({
  query,
  surfaceId,
  locale: _locale,
}: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}): Promise<LauncherItem[]> {
  if (surfaceId !== 'global-launcher') return []

  // D2: only process-manager mode (explicit kill/杀/结束). Ordinary queries must not list terminate.
  if (!isProcessModeQuery(query)) return []

  const stripped = stripProcessQueryPrefix(query).trim()
  // Bare "kill" → "*" lists all non-denied processes (native special token).
  const listQuery = stripped || '*'
  const list = await listDesktopProcessesCached(listQuery)
  return list.slice(0, QUERY_PROCESS_LIMIT).map(buildTerminateItem)
}
