/**
 * Launcher Usage Journal — append-only metadata journal.
 *
 * Records first-level launcher selections for ranking / intelligence.
 * Never stores clipboard or content body fields.
 */

export type UsageJournalEntry = {
  commandId: string
  surfaceId: string
  executedAt: number
  prevCommandId?: string | null
  objectKind?: string | null
}

function isTauri(): boolean {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

/**
 * Append one journal row. Swallows errors so callers can fire-and-forget.
 */
export async function appendUsageJournal(entry: UsageJournalEntry): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke<void>('usage_journal_append', {
      commandId: entry.commandId,
      surfaceId: entry.surfaceId,
      executedAt: entry.executedAt,
      prevCommandId: entry.prevCommandId ?? null,
      objectKind: entry.objectKind ?? null,
    })
  } catch (error) {
    console.warn('[hiven] Failed to append usage journal:', error)
  }
}

/**
 * Prune stale or excess journal rows.
 */
export async function pruneUsageJournal(options?: {
  maxAgeDays?: number
  maxRows?: number
}): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke<void>('usage_journal_prune', {
      maxAgeDays: options?.maxAgeDays ?? null,
      maxRows: options?.maxRows ?? null,
    })
  } catch (error) {
    console.warn('[hiven] Failed to prune usage journal:', error)
  }
}
