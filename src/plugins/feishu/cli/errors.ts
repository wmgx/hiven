/**
 * Map lark-cli failures to readable messages + recovery hints.
 * Never surface tokens / secrets / raw JSON envelopes in user-facing text.
 */

const SECRET_PATTERN =
  /(?:token|secret|authorization|bearer|app_secret|app_access_token|user_access_token|refresh_token)\s*[:=]\s*\S+/gi

export type MappedLarkError = {
  message: string
  hint?: string
  code?: string | number
  /** Scopes extracted from missing_scope errors (for i18n). */
  missingScopes?: string[]
}

function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[redacted]')
}

/** True when text looks like a full CLI JSON envelope (should not be shown raw). */
export function looksLikeCliJsonEnvelope(text: string): boolean {
  const t = text.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return false
  return /"ok"\s*:/.test(t) || /"error"\s*:/.test(t) || /"missing_scopes"\s*:/.test(t)
}

/**
 * Prefer a short human message over dumping CLI JSON.
 */
export function humanizeCliText(text: string | undefined): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (!looksLikeCliJsonEnvelope(trimmed)) {
    return redactSecrets(trimmed).slice(0, 280)
  }
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    const err = obj.error
    if (err && typeof err === 'object' && !Array.isArray(err)) {
      const e = err as Record<string, unknown>
      if (typeof e.message === 'string' && e.message.trim()) {
        return redactSecrets(e.message).slice(0, 280)
      }
    }
    if (typeof obj.message === 'string' && obj.message.trim()) {
      return redactSecrets(obj.message).slice(0, 280)
    }
  } catch {
    // fall through
  }
  return 'lark-cli request failed'
}

export function mapLarkCliError(input: {
  exitCode?: number | null
  timedOut?: boolean
  stderr?: string
  stdoutMessage?: string
  code?: string | number
  parseFailed?: boolean
  notInstalled?: boolean
  missingScopes?: string[]
}): MappedLarkError {
  if (input.notInstalled) {
    return {
      message: 'lark-cli is not installed or not on PATH',
      hint: 'Install lark-cli and ensure it is available as `lark-cli`, or set an absolute path in Feishu settings.',
      code: 'not_installed',
    }
  }

  if (input.timedOut) {
    return {
      message: 'lark-cli timed out',
      hint: 'Retry with a shorter query, or check network / VPN connectivity.',
      code: 'timeout',
    }
  }

  if (input.code === 'confirmation_required') {
    return {
      message: 'Confirmation required before running a write operation',
      hint: 'Confirm the action in the launcher, then try again.',
      code: 'confirmation_required',
    }
  }

  if (input.code === 'aborted') {
    return {
      message: 'Request was cancelled',
      code: 'aborted',
    }
  }

  if (input.parseFailed) {
    // stderr may still hold a valid error envelope — try to humanize it first
    const fromStderr = humanizeCliText(input.stderr)
    const scopes = input.missingScopes?.length
      ? input.missingScopes
      : extractMissingScopes(input.stderr, input.stdoutMessage)
    if (scopes.length > 0) {
      return {
        message: `Missing Feishu permission: ${scopes.join(', ')}`,
        hint: `Run: lark-cli auth login --scope "${scopes.join(' ')}"`,
        code: 'missing_scope',
        missingScopes: scopes,
      }
    }
    if (fromStderr && fromStderr !== 'lark-cli request failed') {
      return {
        message: fromStderr,
        hint: /scope|permission|authoriz|login/i.test(fromStderr)
          ? 'Open Feishu Login or run `lark-cli auth login` with the required scopes.'
          : undefined,
        code: input.code ?? 'cli_error',
      }
    }
    return {
      message: 'Failed to parse lark-cli JSON output',
      hint: 'Upgrade lark-cli or re-run with --json.',
      code: 'parse_error',
    }
  }

  const scopes =
    input.missingScopes?.length
      ? input.missingScopes
      : extractMissingScopes(input.stderr, input.stdoutMessage, String(input.code ?? ''))

  if (
    scopes.length > 0 ||
    input.code === 'missing_scope' ||
    input.code === 'authorization'
  ) {
    const list = scopes.length > 0 ? scopes : []
    return {
      message:
        list.length > 0
          ? `Missing Feishu permission: ${list.join(', ')}`
          : 'Missing Feishu permission (authorization / scope)',
      hint:
        list.length > 0
          ? `Run: lark-cli auth login --scope "${list.join(' ')}"`
          : 'Re-login with the required scopes via `lark-cli auth login --scope …`.',
      code: 'missing_scope',
      missingScopes: list.length > 0 ? list : undefined,
    }
  }

  const raw =
    humanizeCliText(input.stdoutMessage) ||
    humanizeCliText(input.stderr) ||
    (input.code != null ? String(input.code) : '') ||
    (input.exitCode != null && input.exitCode !== 0 ? `exit ${input.exitCode}` : 'Unknown CLI error')

  const message = redactSecrets(raw).slice(0, 280)
  const lower = message.toLowerCase()

  let hint: string | undefined
  if (/not\s+login|unauthoriz|not\s+authenticated|token.*(expir|invalid)|login\s+required/i.test(lower)) {
    hint = 'Open Feishu settings and run Login, or execute `lark-cli auth login`.'
  } else if (/scope|permission denied|access denied|missing_scope|authorization/i.test(lower)) {
    hint = 'Re-login with the required scopes via `lark-cli auth login --scope …`.'
  } else if (/not found|command not found|no such file/i.test(lower)) {
    hint = 'Install lark-cli or configure the binary path in Feishu settings.'
  } else if (input.exitCode != null && input.exitCode !== 0) {
    hint = 'Check lark-cli doctor / auth status for details.'
  }

  return {
    message,
    hint,
    code: input.code ?? (input.exitCode != null && input.exitCode !== 0 ? input.exitCode : undefined),
  }
}

export function extractMissingScopes(...texts: Array<string | undefined>): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    // JSON-ish: "missing_scopes":["calendar:calendar.event:read"]
    const arrayMatch = text.match(/"missing_scopes"\s*:\s*\[([^\]]+)\]/i)
    if (arrayMatch?.[1]) {
      for (const part of arrayMatch[1].matchAll(/"([^"]+)"/g)) {
        if (part[1]) found.add(part[1])
      }
    }
    // message: missing required scope(s): calendar:calendar.event:read
    const msgMatch = text.match(/missing required scope\(s\):\s*([^\n"']+)/i)
    if (msgMatch?.[1]) {
      for (const scope of msgMatch[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)) {
        // strip trailing punctuation from JSON fragments
        const cleaned = scope.replace(/[\]},]+$/g, '')
        if (cleaned.includes(':')) found.add(cleaned)
      }
    }
  }
  return [...found]
}
