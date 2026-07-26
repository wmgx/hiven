/**
 * Feishu contact domain (B3 read-only): search users by keyword.
 */

import { buildUserChatOpenUrl } from './links'
import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuUser = {
  open_id?: string
  openId?: string
  user_id?: string
  localized_name?: string
  name?: string
  email?: string
  enterprise_email?: string
  department?: string
  p2p_chat_id?: string
  p2pChatId?: string
  has_chatted?: boolean
  is_cross_tenant?: boolean
  signature?: string
}

export type FeishuUserRow = {
  id: string
  title: string
  subtitle: string
  summaryText: string
  p2pChatId?: string
  /** Client deep link to open DM / chat. */
  openUrl?: string
  keywords: string[]
}

export async function searchUsers(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ ok: boolean; users: FeishuUser[]; message?: string; code?: string | number; hint?: string }> {
  const query = options.query.trim()
  if (!query) return { ok: true, users: [] }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: ['contact', '+search-user', '--query', query, '--as', 'user', '--page-size', '20'],
    timeoutMs: options.timeoutMs ?? 10000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return { ok: false, users: [], message: result.message, code: result.code, hint: result.hint }
  }
  return { ok: true, users: extractUsers(result.data) }
}

export function mapUsersToRows(users: FeishuUser[]): FeishuUserRow[] {
  return users.map((user, index) => {
    const id = String(user.open_id ?? user.openId ?? user.user_id ?? `user-${index}`)
    const title = String(user.localized_name ?? user.name ?? id).trim() || id
    const email = user.enterprise_email ?? user.email
    const parts = [
      email,
      user.department,
      user.has_chatted ? 'chatted' : undefined,
      user.is_cross_tenant ? 'external' : undefined,
      id,
    ].filter(Boolean) as string[]
    const p2pChatId = user.p2p_chat_id ?? user.p2pChatId
    const subtitle = parts.join(' · ')
    const openUrl = buildUserChatOpenUrl({ p2pChatId, openId: id })
    const summaryText = [
      title,
      email ? `email: ${email}` : '',
      user.department ? `dept: ${user.department}` : '',
      `open_id: ${id}`,
      p2pChatId ? `p2p_chat_id: ${p2pChatId}` : '',
      openUrl ?? '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      id,
      title,
      subtitle,
      summaryText,
      p2pChatId: p2pChatId || undefined,
      openUrl,
      keywords: [title, email ?? '', user.department ?? '', id].filter(Boolean),
    }
  })
}

function extractUsers(data: unknown): FeishuUser[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.filter((item): item is FeishuUser => item != null && typeof item === 'object')
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['users', 'items', 'results', 'list']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (item): item is FeishuUser => item != null && typeof item === 'object',
      )
    }
  }
  if (obj.data && typeof obj.data === 'object') {
    return extractUsers(obj.data)
  }
  return []
}
