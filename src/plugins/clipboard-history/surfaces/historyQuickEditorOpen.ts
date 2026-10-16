import type { PluginSurfaceFeedbackOwner } from '@hiven/plugin'
import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'

export type HistoryQuickEditorSnapshot = {
  id: string
  hash: string
  text: string
}

export type HistoryQuickEditorReadResult =
  | { status: 'ready'; snapshot: HistoryQuickEditorSnapshot }
  | { status: 'unavailable' | 'interrupted' }

export type HistoryQuickEditorOpenResult =
  | { status: 'opened' }
  | { status: 'changed' | 'unavailable' | 'failed' | 'interrupted' }

export type HistoryQuickEditorSubmission = {
  signal: AbortSignal
  isCurrent(): boolean
  commit(): void
  finish(): void
}

/** One owner-bound read/open attempt at a time; stale callbacks cannot revive. */
export function createHistoryQuickEditorLifecycle() {
  let active: { controller: AbortController; committed: boolean } | null = null

  const cancel = () => {
    if (active && !active.committed) active.controller.abort()
    active = null
  }

  return {
    begin(owner?: PluginSurfaceFeedbackOwner): HistoryQuickEditorSubmission | null {
      cancel()
      if (owner?.isCurrent() === false) return null
      const submission = { controller: new AbortController(), committed: false }
      active = submission
      const isCurrent = () => active === submission
        && !submission.controller.signal.aborted
        && owner?.isCurrent() !== false
      return {
        signal: submission.controller.signal,
        isCurrent,
        commit: () => { if (isCurrent()) submission.committed = true },
        finish: () => { if (active === submission) active = null },
      }
    },
    cancel,
  }
}

/** Always hydrate from storage: list previews are deliberately incomplete. */
export async function readHistoryQuickEditorSnapshot(
  repository: ClipboardHistoryRepository,
  itemId: string,
  isCurrent: () => boolean,
): Promise<HistoryQuickEditorReadResult> {
  if (!isCurrent()) return { status: 'interrupted' }
  const item = await repository.getItem(itemId)
  if (!isCurrent()) return { status: 'interrupted' }
  if (item?.kind !== 'text') return { status: 'unavailable' }
  return { status: 'ready', snapshot: { id: item.id, hash: item.hash, text: item.text } }
}

/** Revalidate the accepted snapshot immediately before the host handoff. */
export async function openHistoryQuickEditorSnapshot(
  repository: ClipboardHistoryRepository,
  snapshot: HistoryQuickEditorSnapshot,
  open: (text: string, options?: { signal?: AbortSignal; commit?: () => void }) => Promise<boolean>,
  submission: HistoryQuickEditorSubmission,
): Promise<HistoryQuickEditorOpenResult> {
  if (!submission.isCurrent()) return { status: 'interrupted' }
  const current = await repository.getItem(snapshot.id)
  if (!submission.isCurrent()) return { status: 'interrupted' }
  if (current?.kind !== 'text') return { status: 'unavailable' }
  if (current.hash !== snapshot.hash || current.text !== snapshot.text) return { status: 'changed' }
  try {
    return await open(current.text, { signal: submission.signal, commit: submission.commit })
      ? { status: 'opened' }
      : submission.isCurrent() ? { status: 'failed' } : { status: 'interrupted' }
  } catch {
    return submission.isCurrent() ? { status: 'failed' } : { status: 'interrupted' }
  }
}
