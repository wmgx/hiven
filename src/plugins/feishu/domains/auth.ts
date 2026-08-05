/**
 * Feishu auth domain: status + login split-flow via lark-cli.
 */

import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuAuthStatus = {
  loggedIn: boolean
  summary: string
  profile?: string
  raw?: unknown
  code?: string | number
}

export type FeishuLoginStart = {
  ok: boolean
  verificationUrl?: string
  deviceCode?: string
  userCode?: string
  message?: string
  raw?: unknown
}

export type FeishuLoginComplete = {
  ok: boolean
  message?: string
  raw?: unknown
}

export async function getAuthStatus(
  shell: LarkCliShell,
  binaryPath?: string,
  signal?: AbortSignal,
): Promise<FeishuAuthStatus> {
  // Prefer auth status; fall back to whoami
  const status = await runLarkCli({
    shell,
    binaryPath,
    args: ['auth', 'status'],
    timeoutMs: 8000,
    signal,
    risk: 'read',
  })

  if (status.ok) {
    return {
      loggedIn: inferLoggedIn(status.data) ?? true,
      summary: formatStatusSummary(status.data) || 'Authenticated',
      profile: extractProfile(status.data),
      raw: status.data,
      code: status.code,
    }
  }

  const whoami = await runLarkCli({
    shell,
    binaryPath,
    args: ['auth', 'whoami'],
    timeoutMs: 8000,
    signal,
    risk: 'read',
  })

  if (whoami.ok) {
    return {
      loggedIn: true,
      summary: formatStatusSummary(whoami.data) || 'Authenticated',
      profile: extractProfile(whoami.data),
      raw: whoami.data,
      code: whoami.code,
    }
  }

  const msg = status.message || whoami.message || 'Not authenticated'
  const lower = msg.toLowerCase()
  const loggedIn = !/not\s+login|unauthoriz|not\s+authenticated|login\s+required|token/i.test(lower)
    ? false
    : false

  return {
    loggedIn,
    summary: msg,
    raw: status.data ?? whoami.data,
    code: status.code ?? whoami.code,
  }
}

/**
 * Start device / browser login without blocking (`auth login --no-wait --json`).
 * Optionally request additional scopes (e.g. after missing_scope errors).
 */
export async function startLogin(
  shell: LarkCliShell,
  binaryPath?: string,
  signal?: AbortSignal,
  scopes?: string[],
): Promise<FeishuLoginStart> {
  const args = ['auth', 'login', '--no-wait']
  const scopeList = (scopes ?? []).map((s) => s.trim()).filter(Boolean)
  if (scopeList.length > 0) {
    args.push('--scope', scopeList.join(','))
  }

  const result = await runLarkCli({
    shell,
    binaryPath,
    args,
    timeoutMs: 15000,
    signal,
    risk: 'read',
  })

  // --no-wait returns device_code on success; payload is usually under data.
  const data = extractLoginPayload(result.data) ?? {}
  const verificationUrl =
    pickString(data, ['verification_url', 'verificationUrl', 'url', 'auth_url', 'authUrl']) ??
    pickNestedUrl(result.data) ??
    pickNestedUrl(data)

  if (!result.ok && !verificationUrl) {
    return {
      ok: false,
      message:
        result.message ||
        'Failed to start login. Try `lark-cli auth login` in a terminal.',
      raw: result.data,
    }
  }

  return {
    ok: true,
    verificationUrl,
    deviceCode: pickString(data, ['device_code', 'deviceCode']),
    userCode: pickString(data, ['user_code', 'userCode']),
    message: result.message,
    raw: result.data ?? data,
  }
}

function extractLoginPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>
  if (
    obj.verification_url ||
    obj.verificationUrl ||
    obj.device_code ||
    obj.deviceCode
  ) {
    return obj
  }
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    return extractLoginPayload(obj.data)
  }
  return obj
}

/**
 * Complete login after user authorization (`auth login --device-code …` best-effort).
 */
export async function completeLogin(
  shell: LarkCliShell,
  options?: {
    binaryPath?: string
    deviceCode?: string
    signal?: AbortSignal
  },
): Promise<FeishuLoginComplete> {
  const args = ['auth', 'login']
  if (options?.deviceCode) {
    args.push('--device-code', options.deviceCode)
  }

  const result = await runLarkCli({
    shell,
    binaryPath: options?.binaryPath,
    args,
    timeoutMs: 60000,
    signal: options?.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.message ||
        'Could not complete login. Finish authorization in the browser, then re-check status.',
      raw: result.data,
    }
  }

  return {
    ok: true,
    message: result.message || 'Login completed',
    raw: result.data,
  }
}

function inferLoggedIn(data: unknown): boolean | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  if (typeof obj.logged_in === 'boolean') return obj.logged_in
  if (typeof obj.loggedIn === 'boolean') return obj.loggedIn
  if (typeof obj.authenticated === 'boolean') return obj.authenticated
  if (obj.user || obj.profile || obj.name || obj.open_id || obj.openId) return true
  return undefined
}

function extractProfile(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  return (
    pickString(obj, ['name', 'user_name', 'userName', 'email', 'profile', 'open_id', 'openId']) ??
    undefined
  )
}

function formatStatusSummary(data: unknown): string {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (typeof data !== 'object') return String(data)
  const obj = data as Record<string, unknown>
  const name = pickString(obj, ['name', 'user_name', 'userName', 'email'])
  const profile = pickString(obj, ['profile'])
  if (name && profile) return `${name} (${profile})`
  if (name) return name
  if (profile) return profile
  try {
    return JSON.stringify(data).slice(0, 200)
  } catch {
    return ''
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function pickNestedUrl(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
    if (value && typeof value === 'object') {
      const nested = pickNestedUrl(value)
      if (nested) return nested
    }
  }
  return undefined
}
