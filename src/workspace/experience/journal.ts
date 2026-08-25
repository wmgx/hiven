import { telemetryOpenId } from '../telemetry'
import type { ExperienceEvent } from './types'

const PAUSED_KEY = 'hiven:experience-learning-paused'
let appendQueue = Promise.resolve()

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export function newExperienceId(prefix: 'event' | 'run' | 'session'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}_${random}`
}

export function currentExperienceSessionId(fallback: string): string {
  return telemetryOpenId() ?? fallback
}

export function isExperienceLearningPaused(): boolean {
  try {
    return window.localStorage.getItem(PAUSED_KEY) === '1'
  } catch {
    return false
  }
}

export function setExperienceLearningPaused(paused: boolean): void {
  try {
    window.localStorage.setItem(PAUSED_KEY, paused ? '1' : '0')
  } catch {
    // Session-only fallback: writes remain enabled if storage is unavailable.
  }
}

export function appendExperienceEvent(event: ExperienceEvent): void {
  if (!isTauri() || isExperienceLearningPaused()) return
  appendQueue = appendQueue
    .then(() => invoke<void>('experience_journal_append', { event }))
    .catch((error) => {
      console.warn('[hiven] Failed to append experience journal:', error)
    })
}

export async function exportExperienceEvents(): Promise<string> {
  if (!isTauri()) return '[]'
  return invoke<string>('experience_journal_export')
}

export async function clearExperienceEventsSince(sinceTs: number): Promise<void> {
  if (!isTauri()) return
  await invoke<void>('experience_journal_clear_since', { sinceTs })
}

export async function clearAllExperienceEvents(): Promise<void> {
  if (!isTauri()) return
  await invoke<void>('experience_journal_clear_all')
}
