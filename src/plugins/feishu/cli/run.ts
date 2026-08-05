/**
 * Controlled lark-cli spawn via host shell.run.
 * Write / high-risk-write require explicit confirmation before any shell call.
 */

import { extractMissingScopes, mapLarkCliError } from './errors'
import { parseLarkCliJson, type LarkCliParsed } from './parse'

export type LarkCliRisk = 'read' | 'write' | 'high-risk-write'

export type LarkCliShell = {
  run: (o: {
    command: string
    timeoutMs?: number
  }) => Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
    timedOut: boolean
  }>
}

export type RunLarkCliOptions = {
  shell: LarkCliShell
  binaryPath?: string
  args: string[]
  timeoutMs?: number
  signal?: AbortSignal
  risk?: LarkCliRisk
  confirmed?: boolean
}

export type LarkCliResult = {
  ok: boolean
  data?: unknown
  stderr?: string
  code?: string | number
  cliNotice?: unknown
  message?: string
  hint?: string
}

function shellQuote(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:=+@%,-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

function resolveBinary(binaryPath?: string): string {
  const trimmed = (binaryPath ?? '').trim()
  return trimmed || 'lark-cli'
}

function ensureJsonFlag(args: string[]): string[] {
  if (args.includes('--json')) return [...args]
  return [...args, '--json']
}

function ensureYesFlag(args: string[]): string[] {
  if (args.includes('--yes') || args.includes('-y')) return [...args]
  return [...args, '--yes']
}

function buildCommand(binaryPath: string | undefined, args: string[]): string {
  const binary = resolveBinary(binaryPath)
  const withJson = ensureJsonFlag(args)
  return [shellQuote(binary), ...withJson.map(shellQuote)].join(' ')
}

function safeJsonSlice(value: unknown): string | undefined {
  try {
    return JSON.stringify(value).slice(0, 500)
  } catch {
    return undefined
  }
}

/**
 * lark-cli often prints error envelopes on stderr (exit≠0) while stdout is empty.
 * Prefer stdout when it parses; otherwise fall back to stderr JSON.
 */
export function pickCliJsonText(stdout: string, stderr: string): string {
  const out = (stdout ?? '').trim()
  const err = (stderr ?? '').trim()
  if (out) {
    const parsed = parseLarkCliJson(out)
    if (parsed.code !== 'parse_error' && parsed.code !== 'empty_output') return out
  }
  if (err) {
    const parsed = parseLarkCliJson(err)
    if (parsed.code !== 'parse_error' && parsed.code !== 'empty_output') return err
  }
  return out || err
}

function parseCliStreams(stdout: string, stderr: string): LarkCliParsed {
  return parseLarkCliJson(pickCliJsonText(stdout, stderr))
}

export async function runLarkCli(options: RunLarkCliOptions): Promise<LarkCliResult> {
  const risk = options.risk ?? 'read'

  if ((risk === 'write' || risk === 'high-risk-write') && options.confirmed !== true) {
    return {
      ok: false,
      code: 'confirmation_required',
      message: 'Confirmation required before write / high-risk-write CLI calls',
    }
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      code: 'aborted',
      message: 'Request was cancelled',
    }
  }

  // After L2 confirmation, attach --yes for write / high-risk-write when CLI expects it.
  const args =
    (risk === 'write' || risk === 'high-risk-write') && options.confirmed === true
      ? ensureYesFlag(options.args)
      : options.args
  const command = buildCommand(options.binaryPath, args)
  let shellResult: {
    stdout: string
    stderr: string
    exitCode: number | null
    timedOut: boolean
  }

  try {
    shellResult = await options.shell.run({
      command,
      timeoutMs: options.timeoutMs,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const mapped = mapLarkCliError({
      stderr: msg,
      notInstalled: /not found|ENOENT|command not found/i.test(msg),
    })
    return {
      ok: false,
      code: mapped.code,
      message: mapped.message,
      hint: mapped.hint,
      stderr: msg.slice(0, 500),
    }
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      code: 'aborted',
      message: 'Request was cancelled',
    }
  }

  if (shellResult.timedOut) {
    const mapped = mapLarkCliError({ timedOut: true })
    return {
      ok: false,
      code: mapped.code,
      message: mapped.message,
      hint: mapped.hint,
      stderr: shellResult.stderr,
    }
  }

  const parsed = parseCliStreams(shellResult.stdout, shellResult.stderr)
  if (parsed.code === 'parse_error' || parsed.code === 'empty_output') {
    const mapped = mapLarkCliError({
      exitCode: shellResult.exitCode,
      stderr: shellResult.stderr,
      stdoutMessage: shellResult.stdout.slice(0, 300),
      parseFailed: true,
      missingScopes: extractMissingScopes(shellResult.stderr, shellResult.stdout),
    })
    return {
      ok: false,
      code: mapped.code,
      message: mapped.message,
      hint: mapped.hint,
      stderr: shellResult.stderr,
    }
  }

  if (!parsed.ok || (shellResult.exitCode != null && shellResult.exitCode !== 0)) {
    const scopes = extractMissingScopes(
      shellResult.stderr,
      shellResult.stdout,
      parsed.message,
      typeof parsed.error === 'string' ? parsed.error : safeJsonSlice(parsed.error),
    )
    const stdoutMessage =
      parsed.message ||
      (scopes.length ? `missing required scope(s): ${scopes.join(', ')}` : undefined) ||
      (parsed.error != null && !scopes.length ? humanErrorFromParsed(parsed) : undefined) ||
      undefined
    const mapped = mapLarkCliError({
      exitCode: shellResult.exitCode,
      stderr: shellResult.stderr,
      stdoutMessage,
      code: parsed.code,
      missingScopes: scopes,
    })
    return {
      ok: false,
      data: parsed.data,
      code: mapped.code ?? parsed.code,
      message: mapped.message,
      hint: mapped.hint,
      stderr: shellResult.stderr,
      cliNotice: parsed.cliNotice,
    }
  }

  return {
    ok: true,
    data: parsed.data,
    code: parsed.code,
    message: parsed.message,
    cliNotice: parsed.cliNotice,
    stderr: shellResult.stderr || undefined,
  }
}

function humanErrorFromParsed(parsed: LarkCliParsed): string | undefined {
  if (parsed.message) return parsed.message
  if (parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)) {
    const msg = (parsed.error as Record<string, unknown>).message
    if (typeof msg === 'string') return msg
  }
  return undefined
}
