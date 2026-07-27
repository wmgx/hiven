/**
 * Contact avatar enrichment.
 *
 * `contact +search-user` does not return avatar URLs. Real avatars need a follow-up
 * contact batch API (scope contact:contact.base:readonly or contact:user.base:readonly).
 * We cache by open_id for the session and soft-request the scope once if missing.
 */

import { startLogin } from './auth'
import { isHttpIconUrl } from './icons'
import { runLarkCli, type LarkCliShell } from '../cli/run'

const avatarByOpenId = new Map<string, string>()
let scopeMissing = false
let scopeAuthAttempted = false

export function getCachedAvatar(openId: string): string | undefined {
  return avatarByOpenId.get(openId)
}

export function setCachedAvatar(openId: string, url: string): void {
  if (!openId || !isHttpIconUrl(url)) return
  avatarByOpenId.set(openId, url.trim())
}

/**
 * Batch-fetch avatar URLs for open_ids. Mutates nothing on failure.
 * Returns map of open_id → https avatar URL for newly resolved entries.
 */
export async function fetchContactAvatars(options: {
  shell: LarkCliShell
  openIds: string[]
  binaryPath?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (scopeMissing) return out

  const need = [...new Set(options.openIds.map((id) => id.trim()).filter(Boolean))].filter(
    (id) => !avatarByOpenId.has(id),
  )
  if (need.length === 0) {
    for (const id of options.openIds) {
      const hit = avatarByOpenId.get(id)
      if (hit) out.set(id, hit)
    }
    return out
  }

  // Feishu allows up to 50 user_ids per batch get.
  const chunk = need.slice(0, 50)
  // GET /open-apis/contact/v3/users/batch?user_id_type=open_id&user_ids=a&user_ids=b
  // lark-cli --params JSON may not expand arrays; pass comma form first, then retry.
  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args: [
      'api',
      'GET',
      '/open-apis/contact/v3/users/batch',
      '--params',
      JSON.stringify({
        user_id_type: 'open_id',
        user_ids: chunk,
      }),
      '--as',
      'user',
    ],
    timeoutMs: options.timeoutMs ?? 4000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    const msg = `${result.message ?? ''} ${result.hint ?? ''} ${result.code ?? ''}`
    if (/missing_scope|contact\.base|contact:contact|contact:user\.base/i.test(msg)) {
      scopeMissing = true
      // Soft: kick off scope grant once so next search can load real avatars.
      if (!scopeAuthAttempted) {
        scopeAuthAttempted = true
        void startLogin(options.shell, options.binaryPath, undefined, [
          'contact:contact.base:readonly',
          'contact:user.base:readonly',
        ]).then((started) => {
          // Caller may open URL via shell; best-effort only.
          if (started.verificationUrl && options.shell) {
            void options.shell
              .run({
                command: `open -a '/Applications/Lark.app' ${shellQuote(started.verificationUrl)} || open ${shellQuote(started.verificationUrl)}`,
                timeoutMs: 2500,
              })
              .catch(() => {})
          }
        })
      }
    }
    return out
  }

  const users = extractBatchUsers(result.data)
  for (const user of users) {
    const id = String(user.open_id ?? user.openId ?? user.user_id ?? '').trim()
    const url = pickAvatarUrl(user)
    if (id && url) {
      avatarByOpenId.set(id, url)
      out.set(id, url)
    }
  }

  // Also return previously cached hits for the full input set
  for (const id of options.openIds) {
    const hit = avatarByOpenId.get(id)
    if (hit) out.set(id, hit)
  }
  return out
}

function pickAvatarUrl(user: Record<string, unknown>): string | undefined {
  const avatar = user.avatar
  if (avatar && typeof avatar === 'object' && !Array.isArray(avatar)) {
    const a = avatar as Record<string, unknown>
    for (const key of ['avatar_72', 'avatar_240', 'avatar_640', 'avatar_origin', 'avatar_url']) {
      if (isHttpIconUrl(a[key] as string)) return String(a[key]).trim()
    }
  }
  for (const key of [
    'avatar_url',
    'avatarUrl',
    'avatar_thumb',
    'avatar_middle',
    'avatar_big',
    'avatar',
  ]) {
    if (isHttpIconUrl(user[key] as string)) return String(user[key]).trim()
  }
  return undefined
}

function extractBatchUsers(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  for (const key of ['items', 'users', 'user_list']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (u): u is Record<string, unknown> => u != null && typeof u === 'object',
      )
    }
  }
  if (obj.data && typeof obj.data === 'object') {
    return extractBatchUsers(obj.data)
  }
  return []
}

function shellQuote(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:=+@%,-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Test helper */
export function clearAvatarCacheForTests(): void {
  avatarByOpenId.clear()
  scopeMissing = false
  scopeAuthAttempted = false
}
