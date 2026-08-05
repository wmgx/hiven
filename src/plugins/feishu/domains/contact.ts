/**
 * Feishu contact domain (B3 read-only): search users by keyword.
 */

import { fetchContactAvatars, getCachedAvatar, setCachedAvatar } from './avatarCache'
import { buildUserChatOpenUrl } from './links'
import { iconForPerson, isHttpIconUrl } from './icons'
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
  avatar?: string
  avatar_url?: string
  avatarUrl?: string
  avatar_thumb?: string
  avatar_middle?: string
}

export type FeishuUserRow = {
  id: string
  title: string
  subtitle: string
  summaryText: string
  p2pChatId?: string
  /** True when the user has IM history with the caller (intersection). */
  hasChatted?: boolean
  /** Client deep link to open DM / chat. */
  openUrl?: string
  /** Remote avatar or generated initials data-URL. */
  icon?: string
  keywords: string[]
}

/**
 * "Intersection" with me: already chatted and/or has an existing p2p chat id.
 * Used to hide strangers from Global Launcher mix-in.
 */
export function hasContactIntersection(user: {
  has_chatted?: boolean
  hasChatted?: boolean
  p2p_chat_id?: string
  p2pChatId?: string
}): boolean {
  if (user.hasChatted === true || user.has_chatted === true) return true
  const p2p = user.p2pChatId ?? user.p2p_chat_id
  return Boolean(p2p && String(p2p).trim())
}

export async function searchUsers(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
  pageSize?: number
  /**
   * When true, only people you've chatted with (lark-cli --has-chatted).
   * Default false for L2「找人」full search; L1 mix-in should pass true.
   */
  onlyChatted?: boolean
}): Promise<{ ok: boolean; users: FeishuUser[]; message?: string; code?: string | number; hint?: string }> {
  const query = options.query.trim()
  if (!query) return { ok: true, users: [] }

  const pageSize = options.pageSize ?? 12
  const args = [
    'contact',
    '+search-user',
    '--query',
    query,
    '--as',
    'user',
    '--page-size',
    String(pageSize),
  ]
  if (options.onlyChatted) {
    args.push('--has-chatted')
  }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: options.timeoutMs ?? 10000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return { ok: false, users: [], message: result.message, code: result.code, hint: result.hint }
  }
  return { ok: true, users: extractUsers(result.data) }
}

/**
 * Search users then best-effort attach real avatars (search API has no avatar field).
 */
export async function searchUsersWithAvatars(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
  pageSize?: number
  onlyChatted?: boolean
}): Promise<{ ok: boolean; users: FeishuUser[]; message?: string; code?: string | number; hint?: string }> {
  const search = await searchUsers(options)
  if (!search.ok || search.users.length === 0) return search

  const openIds = search.users
    .map((u) => String(u.open_id ?? u.openId ?? u.user_id ?? '').trim())
    .filter(Boolean)

  try {
    await fetchContactAvatars({
      shell: options.shell,
      openIds,
      binaryPath: options.binaryPath,
      signal: options.signal,
      timeoutMs: Math.min(3500, options.timeoutMs ?? 3500),
    })
  } catch {
    // avatars are best-effort
  }

  // Stamp cached avatars onto user objects for mapUsersToRows
  const stamped = search.users.map((user) => {
    const id = String(user.open_id ?? user.openId ?? user.user_id ?? '').trim()
    const cached = id ? getCachedAvatar(id) : undefined
    if (!cached) return user
    return { ...user, avatar_url: cached, avatarUrl: cached }
  })
  return { ...search, users: stamped }
}

export function mapUsersToRows(users: FeishuUser[]): FeishuUserRow[] {
  return users.map((user, index) => {
    const id = String(user.open_id ?? user.openId ?? user.user_id ?? `user-${index}`)
    const title = String(user.localized_name ?? user.name ?? id).trim() || id
    const email = user.enterprise_email ?? user.email
    const p2pChatId = user.p2p_chat_id ?? user.p2pChatId
    const hasChatted = hasContactIntersection(user)
    const parts = [
      email,
      user.department,
      hasChatted ? '已聊过' : '未聊过',
      user.is_cross_tenant ? 'external' : undefined,
    ].filter(Boolean) as string[]
    const subtitle = parts.join(' · ')
    const openUrl = buildUserChatOpenUrl({ p2pChatId, openId: id })
    const avatarUrl =
      getCachedAvatar(id) ||
      user.avatar_url ||
      user.avatarUrl ||
      user.avatar_middle ||
      user.avatar_thumb ||
      user.avatar
    if (isHttpIconUrl(avatarUrl)) setCachedAvatar(id, avatarUrl)
    const icon = iconForPerson({ name: title, id, avatarUrl })
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
      hasChatted,
      openUrl,
      icon,
      keywords: [title, email ?? '', user.department ?? '', id].filter(Boolean),
    }
  })
}

/** Prefer people you've chatted with; stable among ties. */
export function sortUsersByIntersection(rows: FeishuUserRow[]): FeishuUserRow[] {
  return [...rows].sort((a, b) => {
    const ai = a.hasChatted || a.p2pChatId ? 1 : 0
    const bi = b.hasChatted || b.p2pChatId ? 1 : 0
    if (ai !== bi) return bi - ai
    return a.title.localeCompare(b.title, 'zh')
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
