import { invoke } from '@tauri-apps/api/core'
import type { PluginPermissionSnapshot, PluginShellApi, ShellRunOptions, ShellRunResult } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'
import { launcherPerfNow, logLauncherPerfDuration } from './launcher/perf'

function commandFingerprint(command: string): string {
  // Never log full command (may include message text / paths). Keep argv shape only.
  const parts = command.trim().split(/\s+/).slice(0, 6)
  return parts
    .map((p, i) => (i === 0 ? p : p.length > 24 ? `${p.slice(0, 12)}…` : p))
    .join(' ')
}

export function createPluginShell(permissions: PluginPermissionSnapshot): PluginShellApi {
  return {
    async run(options: ShellRunOptions): Promise<ShellRunResult> {
      requirePluginPermissions(permissions, ['shell.run'])
      const startedAt = launcherPerfNow()
      try {
        const result = await invoke<ShellRunResult>('plugin_shell_run', { request: options })
        logLauncherPerfDuration('plugin-shell:run', startedAt, {
          timeoutMs: options.timeoutMs ?? null,
          commandFp: commandFingerprint(options.command),
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdoutBytes: result.stdoutBytes,
          stderrBytes: result.stderrBytes,
        })
        return result
      } catch (error) {
        logLauncherPerfDuration('plugin-shell:run', startedAt, {
          failed: true,
          timeoutMs: options.timeoutMs ?? null,
          commandFp: commandFingerprint(options.command),
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  }
}
