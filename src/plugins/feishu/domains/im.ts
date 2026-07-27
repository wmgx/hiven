/**
 * Feishu IM domain (B3 read-only): chat search / recent chat list.
 * No message send here — write is B4.
 */

import { buildChatOpenUrl } from './links'
import { iconForChat } from './icons'
import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuChat = {
  chat_id?: string
  chatId?: string
  id?: string
  name?: string
  title?: string
  description?: string
  external?: boolean
  chat_status?: string
  chat_mode?: string
  owner_id?: string
  avatar?: string
  avatar_url?: string
  avatarUrl?: string
}

export type FeishuChatRow = {
  id: string
  title: string
  subtitle: string
  summaryText: string
  /** Client deep link to open this chat. */
  openUrl?: string
  /** Group avatar URL when available. */
  icon?: string
  keywords: string[]
}

export async function searchChats(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
  pageSize?: number
}): Promise<{ ok: boolean; chats: FeishuChat[]; message?: string; code?: string | number; hint?: string }> {
  const query = options.query.trim()
  if (!query) return { ok: true, chats: [] }

  const pageSize = options.pageSize ?? 12
  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: ['im', '+chat-search', '--query', query, '--as', 'user', '--page-size', String(pageSize)],
    timeoutMs: options.timeoutMs ?? 10000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return { ok: false, chats: [], message: result.message, code: result.code, hint: result.hint }
  }
  return { ok: true, chats: extractChats(result.data) }
}

export async function listRecentChats(options: {
  shell: LarkCliShell
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ ok: boolean; chats: FeishuChat[]; message?: string; code?: string | number; hint?: string }> {
  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: [
      'im',
      '+chat-list',
      '--as',
      'user',
      '--types',
      'group,p2p',
      '--sort',
      'active_time',
      '--page-size',
      '20',
    ],
    timeoutMs: options.timeoutMs ?? 10000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return { ok: false, chats: [], message: result.message, code: result.code, hint: result.hint }
  }
  return { ok: true, chats: extractChats(result.data) }
}

export function mapChatsToRows(chats: FeishuChat[]): FeishuChatRow[] {
  return chats.map((chat, index) => {
    const id = String(chat.chat_id ?? chat.chatId ?? chat.id ?? `chat-${index}`)
    const title = String(chat.name ?? chat.title ?? id).trim() || id
    const parts: string[] = []
    if (chat.external) parts.push('external')
    if (chat.chat_mode && chat.chat_mode !== 'DEFAULT') parts.push(String(chat.chat_mode))
    if (chat.description) parts.push(String(chat.description).slice(0, 80))
    parts.push(id)
    const subtitle = parts.filter(Boolean).join(' · ')
    const openUrl = id.startsWith('oc_') ? buildChatOpenUrl(id) : undefined
    const avatarUrl = chat.avatar ?? chat.avatar_url ?? chat.avatarUrl
    const icon = iconForChat({ name: title, id, avatarUrl })
    const summaryText = [title, id, openUrl ?? '', chat.description ?? ''].filter(Boolean).join('\n')
    return {
      id,
      title,
      subtitle,
      summaryText,
      openUrl,
      icon,
      keywords: [title, id, chat.description ?? ''].filter(Boolean),
    }
  })
}

function extractChats(data: unknown): FeishuChat[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.filter((item): item is FeishuChat => item != null && typeof item === 'object')
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['chats', 'items', 'results', 'list']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (item): item is FeishuChat => item != null && typeof item === 'object',
      )
    }
  }
  if (obj.data && typeof obj.data === 'object') {
    return extractChats(obj.data)
  }
  return []
}
