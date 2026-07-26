import { invoke } from '@tauri-apps/api/core'
import type { PluginPermissionSnapshot, PluginShellApi, ShellRunOptions, ShellRunResult } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'

export function createPluginShell(permissions: PluginPermissionSnapshot): PluginShellApi {
  return {
    async run(options: ShellRunOptions): Promise<ShellRunResult> {
      requirePluginPermissions(permissions, ['shell.run'])
      return invoke<ShellRunResult>('plugin_shell_run', { request: options })
    },
  }
}
