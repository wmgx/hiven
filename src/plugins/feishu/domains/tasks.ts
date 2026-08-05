/**
 * Feishu tasks (B5 read-only): my tasks list.
 */

import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuTask = {
  task_id?: string
  id?: string
  guid?: string
  summary?: string
  title?: string
  due?: string | { timestamp?: string | number; date?: string }
  completed?: boolean
  status?: string
  url?: string
  share_url?: string
}

export type FeishuTaskRow = {
  id: string
  title: string
  subtitle: string
  summaryText: string
  url?: string
  keywords: string[]
}

export async function listMyTasks(options: {
  shell: LarkCliShell
  binaryPath?: string
  query?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{
  ok: boolean
  tasks: FeishuTask[]
  message?: string
  code?: string | number
  hint?: string
}> {
  const args = ['task', '+get-my-tasks', '--as', 'user', '--page-limit', '20']
  if (options.query?.trim()) args.push('--query', options.query.trim())

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: options.timeoutMs ?? 12000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      tasks: [],
      message: result.message,
      code: result.code,
      hint: result.hint,
    }
  }

  return { ok: true, tasks: extractTasks(result.data) }
}

export function mapTasksToRows(tasks: FeishuTask[]): FeishuTaskRow[] {
  return tasks.map((task, index) => {
    const id = String(task.task_id ?? task.guid ?? task.id ?? `task-${index}`)
    const title = String(task.summary ?? task.title ?? id).trim() || id
    const due = formatDue(task.due)
    const status = task.completed ? 'done' : task.status ?? 'open'
    const subtitle = [status, due].filter(Boolean).join(' · ')
    const url = task.url ?? task.share_url
    const summaryText = [title, due ? `due: ${due}` : '', status, id, url ?? '']
      .filter(Boolean)
      .join('\n')

    return {
      id,
      title,
      subtitle,
      summaryText,
      url: url || undefined,
      keywords: [title, id, status].filter(Boolean),
    }
  })
}

function extractTasks(data: unknown): FeishuTask[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.filter((item): item is FeishuTask => item != null && typeof item === 'object')
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['items', 'tasks', 'results', 'list']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (item): item is FeishuTask => item != null && typeof item === 'object',
      )
    }
  }
  if (obj.data && typeof obj.data === 'object') return extractTasks(obj.data)
  return []
}

function formatDue(due: FeishuTask['due']): string | undefined {
  if (!due) return undefined
  if (typeof due === 'string') return due
  if (due.date) return String(due.date)
  if (due.timestamp != null) {
    const n = Number(due.timestamp)
    if (!Number.isFinite(n)) return undefined
    const ms = n < 1e12 ? n * 1000 : n
    return new Date(ms).toISOString()
  }
  return undefined
}
