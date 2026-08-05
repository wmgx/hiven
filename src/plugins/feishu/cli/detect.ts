/**
 * Probe local lark-cli availability (PATH or configured absolute path).
 */

import type { LarkCliShell } from './run'

export type LarkCliDetectStatus = {
  installed: boolean
  binaryPath: string
  version?: string
  summary?: string
  code?: 'ok' | 'not_installed' | 'error'
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

export async function detectLarkCli(options: {
  shell: LarkCliShell
  binaryPath?: string
  timeoutMs?: number
}): Promise<LarkCliDetectStatus> {
  const binary = resolveBinary(options.binaryPath)
  const timeoutMs = options.timeoutMs ?? 5000

  // Prefer version probe on the configured binary
  try {
    const versionResult = await options.shell.run({
      command: `${shellQuote(binary)} --version`,
      timeoutMs,
    })
    if (!versionResult.timedOut && versionResult.exitCode === 0) {
      const version = (versionResult.stdout || versionResult.stderr).trim().split('\n')[0]?.trim()
      return {
        installed: true,
        binaryPath: binary,
        version,
        summary: version ? `lark-cli ${version}` : 'lark-cli available',
        code: 'ok',
      }
    }
  } catch {
    // fall through
  }

  // PATH lookup when using default name
  if (!(binaryPathIsAbsolute(binary))) {
    try {
      const whichResult = await options.shell.run({
        command: `command -v ${shellQuote(binary)} || which ${shellQuote(binary)}`,
        timeoutMs: Math.min(timeoutMs, 3000),
      })
      if (!whichResult.timedOut && whichResult.exitCode === 0 && whichResult.stdout.trim()) {
        const found = whichResult.stdout.trim().split('\n')[0]?.trim() ?? binary
        return {
          installed: true,
          binaryPath: found,
          summary: `Found at ${found}`,
          code: 'ok',
        }
      }
    } catch {
      // fall through
    }
  }

  // doctor as last-resort summary (may fail if not installed)
  try {
    const doctor = await options.shell.run({
      command: `${shellQuote(binary)} doctor --json 2>/dev/null || ${shellQuote(binary)} doctor`,
      timeoutMs,
    })
    if (!doctor.timedOut && doctor.exitCode === 0) {
      return {
        installed: true,
        binaryPath: binary,
        summary: (doctor.stdout || doctor.stderr).trim().slice(0, 200) || 'doctor ok',
        code: 'ok',
      }
    }
  } catch {
    // fall through
  }

  return {
    installed: false,
    binaryPath: binary,
    summary: 'lark-cli not installed',
    code: 'not_installed',
  }
}

function binaryPathIsAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}
