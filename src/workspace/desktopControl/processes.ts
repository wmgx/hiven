import type { Locale } from '../../i18n'
import type { LauncherExecuteResult, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { auditL2Action } from './audit'

export type DesktopProcess = {
  pid: number
  name: string
  /** CPU percent, e.g. 12.3 */
  cpuPercent?: number
  /** Resident set size in bytes */
  memoryBytes?: number
  /** Stable installed-app id for `app-icon:` when process belongs to a .app */
  appId?: string
}

/**
 * One full snapshot for kill collect-input.
 * Filtering is always client-side — never re-invoke `ps` per keystroke.
 */
const PROCESS_SNAPSHOT_TTL_MS = 8000
const PROCESS_SNAPSHOT_KEY = '*'
/** After client filter, hard cap rows shown in suggest UI. */
export const QUERY_PROCESS_LIMIT = 40

const TERMINATE_PREFIXES = ['杀', '结束', 'kill', 'terminate', 'stop process'] as const

type ProcessListCache = {
  /** Always PROCESS_SNAPSHOT_KEY — single shared snapshot. */
  key: string
  fetchedAt: number
  processes: DesktopProcess[]
}

let processListCache: ProcessListCache | null = null
let processListInflight: Promise<DesktopProcess[]> | null = null

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function processBaseNameLocal(name: string): string {
  const parts = name.split(/[/\\]/)
  return parts[parts.length - 1] || name
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

function processMatchesFilter(proc: DesktopProcess, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q || q === '*') return true
  const name = proc.name.toLowerCase()
  const base = processBaseNameLocal(proc.name).toLowerCase()
  return name.includes(q) || base.includes(q)
}

async function ensureProcessSnapshot(options: { force?: boolean } = {}): Promise<DesktopProcess[]> {
  const now = Date.now()
  if (
    options.force !== true &&
    processListCache &&
    processListCache.key === PROCESS_SNAPSHOT_KEY &&
    now - processListCache.fetchedAt < PROCESS_SNAPSHOT_TTL_MS
  ) {
    return processListCache.processes
  }
  if (processListInflight && options.force !== true) {
    return processListInflight
  }

  if (!isTauriRuntime()) {
    processListCache = { key: PROCESS_SNAPSHOT_KEY, fetchedAt: now, processes: [] }
    return []
  }

  const run = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      // Always full list token; filter happens in JS.
      const processes = (await invoke('list_desktop_processes', {
        query: PROCESS_SNAPSHOT_KEY,
      })) as DesktopProcess[]
      const list = Array.isArray(processes) ? processes : []
      processListCache = {
        key: PROCESS_SNAPSHOT_KEY,
        fetchedAt: Date.now(),
        processes: list,
      }
      return list
    } catch (error) {
      console.warn('[desktop] list_desktop_processes failed:', error)
      // Do not cache failures as empty for TTL.
      return processListCache?.processes ?? []
    } finally {
      processListInflight = null
    }
  })()

  processListInflight = run
  return run
}

/**
 * Kill-mode process list: one native snapshot + JS filter.
 * `query` empty or `*` → top of snapshot; otherwise name/basename substring match.
 */
export async function listDesktopProcessesCached(
  query: string,
  options: { force?: boolean } = {},
): Promise<DesktopProcess[]> {
  const snapshot = await ensureProcessSnapshot(options)
  const filter = query.trim()
  if (!filter || filter === '*') {
    return snapshot.slice(0, QUERY_PROCESS_LIMIT)
  }
  const matched: DesktopProcess[] = []
  for (const proc of snapshot) {
    if (!processMatchesFilter(proc, filter)) continue
    matched.push(proc)
    if (matched.length >= QUERY_PROCESS_LIMIT) break
  }
  return matched
}

/** Test helper: reset in-memory TTL cache. */
export function clearDesktopProcessListCache(): void {
  processListCache = null
  processListInflight = null
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

/**
 * Process manager is a **secondary mode**:
 *   1. User types kill / 杀 / 结束  → enter mode
 *   2. List processes (all if no further text)
 *   3. Further text after the prefix filters the list by process name
 * Ordinary search must never show terminate rows.
 */
export type ProcessModeParse = {
  active: boolean
  /** Name filter after the kill prefix; empty = list all (subject to limit). */
  filter: string
}

export function parseProcessModeQuery(query: string): ProcessModeParse {
  const trimmed = query.trim()
  if (!trimmed) return { active: false, filter: '' }
  const lower = trimmed.toLowerCase()
  for (const prefix of TERMINATE_PREFIXES) {
    if (lower === prefix) {
      return { active: true, filter: '' }
    }
    if (
      lower.startsWith(`${prefix} `) ||
      lower.startsWith(`${prefix}:`) ||
      lower.startsWith(`${prefix}：`)
    ) {
      return {
        active: true,
        filter: trimmed.slice(prefix.length).replace(/^[\s:：]+/, '').trim(),
      }
    }
  }
  return { active: false, filter: '' }
}

/** True only when the user explicitly entered a kill/terminate intent prefix. */
export function isProcessModeQuery(query: string): boolean {
  return parseProcessModeQuery(query).active
}

/**
 * @deprecated First-level dynamic process rows are removed.
 * Use {@link getKillProcessHostItem} (static collect-input command) instead.
 * Kept as empty for any stale callers.
 */
export async function getHostProcessLauncherDynamicItems(_ctx: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}): Promise<LauncherItem[]> {
  return []
}
