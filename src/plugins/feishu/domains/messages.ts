/**
 * Feishu message search (B5 read-only).
 */

import { stripSearchHighlight } from '../cli/parse'
import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuMessageHit = {
  message_id?: string
  messageId?: string
  chat_id?: string
  chat_name?: string
  chat_type?: string
  content?: string
  create_time?: string
  message_app_link?: string
  msg_type?: string
  sender?: { id?: string; sender_type?: string; name?: string }
}

export type FeishuMessageRow = {
  id: string
  title: string
  subtitle: string
  summaryText: string
  url?: string
  keywords: string[]
}

export async function searchMessages(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{
  ok: boolean
  messages: FeishuMessageHit[]
  message?: string
  code?: string | number
  hint?: string
}> {
  const query = options.query.trim()
  if (!query) return { ok: true, messages: [] }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: [
      'im',
      '+messages-search',
      '--query',
      query,
      '--as',
      'user',
      '--page-size',
      '20',
      '--no-reactions',
    ],
    timeoutMs: options.timeoutMs ?? 15000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      messages: [],
      message: result.message,
      code: result.code,
      hint: result.hint,
    }
  }

  return { ok: true, messages: extractMessages(result.data) }
}

export function mapMessagesToRows(messages: FeishuMessageHit[]): FeishuMessageRow[] {
  return messages.map((msg, index) => {
    const id = String(msg.message_id ?? msg.messageId ?? `msg-${index}`)
    const chatName = msg.chat_name ?? msg.chat_id ?? 'chat'
    const rawContent = stripTags(String(msg.content ?? '')).replace(/\s+/g, ' ').trim()
    const preview = rawContent.length > 100 ? rawContent.slice(0, 100) + '…' : rawContent
    const title = preview || id
    const subtitle = [chatName, msg.create_time, msg.msg_type].filter(Boolean).join(' · ')
    const url = msg.message_app_link
    const summaryText = [
      chatName,
      msg.create_time ?? '',
      rawContent,
      url ?? '',
      id,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      id,
      title,
      subtitle,
      summaryText,
      url: url || undefined,
      keywords: [title, chatName, id].filter(Boolean),
    }
  })
}

function extractMessages(data: unknown): FeishuMessageHit[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.filter((item): item is FeishuMessageHit => item != null && typeof item === 'object')
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['messages', 'items', 'results', 'list']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (item): item is FeishuMessageHit => item != null && typeof item === 'object',
      )
    }
  }
  if (obj.data && typeof obj.data === 'object') return extractMessages(obj.data)
  return []
}

function stripTags(text: string): string {
  return stripSearchHighlight(text.replace(/<[^>]+>/g, ' '))
}
