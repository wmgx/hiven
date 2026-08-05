export type UserCommandEntry = {
  id: string
  title: string
  /** Shell command line (single string; host shell runtime runs it). */
  command: string
  /** Optional working directory. */
  cwd?: string
  /** Soft timeout ms (default 15000). */
  timeoutMs?: number
  aliases?: string[]
  enabled?: boolean
  /** Always true for safety in v1 UI; kept for future “trusted” opt-in. */
  requireConfirm?: boolean
}

export type UserCommandsSettings = {
  enabled: boolean
  commands: UserCommandEntry[]
}

export const DEFAULT_USER_COMMANDS_SETTINGS: UserCommandsSettings = {
  enabled: true,
  commands: [
    {
      id: 'echo-hello',
      title: 'Echo hello',
      command: 'echo "hello from hiven"',
      aliases: ['echo', 'hello'],
      enabled: true,
      requireConfirm: true,
      timeoutMs: 10_000,
    },
  ],
}

export function normalizeUserCommandsSettings(raw: unknown): UserCommandsSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_USER_COMMANDS_SETTINGS
  const r = raw as Partial<UserCommandsSettings>
  const commands = Array.isArray(r.commands)
    ? r.commands
        .filter((c): c is UserCommandEntry => Boolean(c && typeof c === 'object' && typeof (c as UserCommandEntry).id === 'string'))
        .map((c) => ({
          id: String(c.id),
          title: String(c.title ?? c.id),
          command: String(c.command ?? ''),
          cwd: c.cwd ? String(c.cwd) : undefined,
          timeoutMs: typeof c.timeoutMs === 'number' && c.timeoutMs > 0 ? c.timeoutMs : 15_000,
          aliases: Array.isArray(c.aliases) ? c.aliases.map(String) : [],
          enabled: c.enabled !== false,
          requireConfirm: c.requireConfirm !== false,
        }))
    : DEFAULT_USER_COMMANDS_SETTINGS.commands
  return {
    enabled: r.enabled !== false,
    commands,
  }
}

export function enabledUserCommands(settings: UserCommandsSettings): UserCommandEntry[] {
  if (!settings.enabled) return []
  return settings.commands.filter((c) => c.enabled !== false && c.command.trim().length > 0)
}
