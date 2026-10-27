import type { LauncherItem } from './types'

/** Material above this size runs on ↵ instead of on every keystroke. */
export const LIVE_PREVIEW_MAX_BYTES = 1024 * 1024

export type ExplicitRunReason = 'effect' | 'large'

/**
 * Why a command waits for ↵ instead of previewing live; undefined when it may
 * preview. Only side-effect-free tools preview, and only on modest material.
 */
export function explicitRunReason(item: Pick<LauncherItem, 'actionPolicy'>, text: string): ExplicitRunReason | undefined {
  if (item.actionPolicy?.effect !== 'pure') return 'effect'
  // UTF-8 needs at most 3 bytes per UTF-16 unit; skip encoding when it cannot exceed the cap.
  if (text.length * 3 <= LIVE_PREVIEW_MAX_BYTES) return undefined
  return new TextEncoder().encode(text).length > LIVE_PREVIEW_MAX_BYTES ? 'large' : undefined
}
