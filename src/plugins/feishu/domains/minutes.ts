/**
 * Feishu minutes search (B5 read-only).
 */

import { stripSearchHighlight } from '../cli/parse'
import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuMinute = {
  token?: string
  id?: string
  display_info?: string
  title?: string
  meta_data?: {
    app_link?: string
    description?: string
    url?: string
  }
  url?: string
  app_link?: string
}

export type FeishuMinuteRow = {
  id: string
  title: string
  subtitle: string
  summaryText: string
  url?: string
  keywords: string[]
}

export async function searchMinutes(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{
  ok: boolean
  minutes: FeishuMinute[]
  message?: string
  code?: string | number
  hint?: string
}> {
  const query = options.query.trim()
  if (!query) return { ok: true, minutes: [] }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: ['minutes', '+search', '--query', query, '--as', 'user', '--page-size', '15'],
    timeoutMs: options.timeoutMs ?? 12000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      minutes: [],
      message: result.message,
      code: result.code,
      hint: result.hint,
    }
  }

  return { ok: true, minutes: extractMinutes(result.data) }
}

export function mapMinutesToRows(minutes: FeishuMinute[]): FeishuMinuteRow[] {
  return minutes.map((item, index) => {
    const id = String(item.token ?? item.id ?? `minute-${index}`)
    const rawTitle =
      item.title ??
      firstLine(item.display_info) ??
      id
    const title = stripSearchHighlight(String(rawTitle)).trim() || id
    const description = item.meta_data?.description ?? ''
    const url = item.meta_data?.app_link ?? item.meta_data?.url ?? item.app_link ?? item.url
    const subtitle = [description, id].filter(Boolean).join(' · ')
    const summaryText = [title, description, url ?? '', id].filter(Boolean).join('\n')

    return {
      id,
      title,
      subtitle,
      summaryText,
      url: url || undefined,
      keywords: [title, id, description].filter(Boolean),
    }
  })
}

function extractMinutes(data: unknown): FeishuMinute[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.filter((item): item is FeishuMinute => item != null && typeof item === 'object')
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['items', 'minutes', 'results', 'list']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (item): item is FeishuMinute => item != null && typeof item === 'object',
      )
    }
  }
  if (obj.data && typeof obj.data === 'object') return extractMinutes(obj.data)
  return []
}

function firstLine(text?: string): string | undefined {
  if (!text) return undefined
  const line = text.split('\n').map((l) => l.trim()).find(Boolean)
  return line
}
