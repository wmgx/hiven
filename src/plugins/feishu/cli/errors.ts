/**
 * Map lark-cli failures to readable messages + recovery hints.
 * Never surface tokens / secrets in messages.
 */

const SECRET_PATTERN =
  /(?:token|secret|authorization|bearer|app_secret|app_access_token|user_access_token|refresh_token)\s*[:=]\s*\S+/gi

export type MappedLarkError = {
  message: string
  hint?: string
  code?: string | number
}

function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, '[redacted]')
}

export function mapLarkCliError(input: {
  exitCode?: number | null
  timedOut?: boolean
  stderr?: string
  stdoutMessage?: string
  code?: string | number
  parseFailed?: boolean
  notInstalled?: boolean
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
    return {
      message: 'Failed to parse lark-cli JSON output',
      hint: 'Upgrade lark-cli or re-run with --json.',
      code: 'parse_error',
    }
  }

  const raw =
    (input.stdoutMessage && input.stdoutMessage.trim()) ||
    (input.stderr && input.stderr.trim()) ||
    (input.code != null ? String(input.code) : '') ||
    (input.exitCode != null && input.exitCode !== 0 ? `exit ${input.exitCode}` : 'Unknown CLI error')

  const message = redactSecrets(raw).slice(0, 500)
  const lower = message.toLowerCase()

  let hint: string | undefined
  const missingScopes = extractMissingScopes(input.stderr, input.stdoutMessage)
  if (missingScopes.length > 0) {
    hint = `Run: lark-cli auth login --scope "${missingScopes.join(' ')}"`
  } else if (/not\s+login|unauthoriz|not\s+authenticated|token.*(expir|invalid)|login\s+required/i.test(lower)) {
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

function extractMissingScopes(...texts: Array<string | undefined>): string[] {
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
        found.add(scope)
      }
    }
  }
  return [...found]
}
