type ReloadParticipant = {
  stop: () => Promise<void>
  resume: () => void
}

const participants = new Map<string, ReloadParticipant>()
let reloading = false

const RECORDING_PARTICIPANTS = new Set(['global-launcher', 'quick-editor', 'plugin-surfaces', 'apps'])
const RECORDING_LEASE_MS = 10_000
const recordingTokens = new Set<symbol>()
let recordingQueue: Promise<void> = Promise.resolve()
let recordingPaused: ReloadParticipant[] | null = null

export type ShortcutRecordingLease = { release(): void }
export type ShortcutRecordingClaim = {
  acquired: Promise<ShortcutRecordingLease | null>
  cancel(): void
}

export function isShortcutRecordingLeaseActive(): boolean {
  return recordingTokens.size > 0
}

/** Keep React cleanup synchronous, while controlled reloads can await native cleanup. */
export function registerHotkeyReloadParticipant(name: string, participant: ReloadParticipant): () => void {
  let stopping: Promise<void> | undefined
  const entry: ReloadParticipant = {
    resume: participant.resume,
    stop: () => {
      if (!stopping) {
        if (participants.get(name) === entry) participants.delete(name)
        stopping = (async () => { await participant.stop() })()
      }
      return stopping
    },
  }
  participants.set(name, entry)
  return () => {
    // A failed reload may have resumed this registrar with a new installation.
    void participants.get(name)?.stop().catch((error) => {
      console.warn('[hiven] Failed to stop hotkeys:', name, error)
    })
  }
}

/**
 * Pause only this host's ordinary global-shortcut registrars while a settings
 * recorder owns the keyboard. The host deadline restores them even if the
 * recorder never delivers its completion callback.
 */
export function claimShortcutRecordingLease(): ShortcutRecordingClaim {
  const token = Symbol('shortcut-recording-lease')
  let cancelled = false
  let timer: number | null = null
  recordingTokens.add(token)

  const release = () => {
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    if (!recordingTokens.delete(token)) return
    void enqueueRecording(resumeRecordingParticipantsIfIdle)
  }

  const acquired = enqueueRecording(async (): Promise<ShortcutRecordingLease | null> => {
    try {
      if (cancelled || !recordingTokens.has(token)) return null
      if (!recordingPaused) {
        if (reloading) throw new Error('Hotkeys are already stopping for reload')
        const active = [...participants.entries()]
          .filter(([name]) => RECORDING_PARTICIPANTS.has(name))
          .map(([, participant]) => participant)
        const results = await Promise.allSettled(active.map((participant) => participant.stop()))
        const failure = results.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') {
          for (const participant of active) participant.resume()
          throw failure.reason
        }
        recordingPaused = active
      }
      if (cancelled || !recordingTokens.has(token)) {
        await resumeRecordingParticipantsIfIdle()
        return null
      }
      timer = window.setTimeout(release, RECORDING_LEASE_MS)
      return { release }
    } catch (error) {
      recordingTokens.delete(token)
      await resumeRecordingParticipantsIfIdle()
      throw error
    }
  })

  return {
    acquired,
    cancel: () => {
      cancelled = true
      release()
    },
  }
}

function enqueueRecording<T>(work: () => Promise<T>): Promise<T> {
  const result = recordingQueue.catch(() => undefined).then(work)
  recordingQueue = result.then(() => undefined, () => undefined)
  return result
}

async function resumeRecordingParticipantsIfIdle(): Promise<void> {
  if (recordingTokens.size > 0 || !recordingPaused) return
  const paused = recordingPaused
  recordingPaused = null
  for (const participant of paused) participant.resume()
}

/** Only a controlled reload may release the registrations owned by this page. */
export async function reloadPageAfterHotkeysStop(commit: () => void): Promise<void> {
  if (reloading) throw new Error('A page reload is already being prepared')
  reloading = true
  const active = [...participants.values()]
  try {
    const results = await Promise.allSettled(active.map((entry) => entry.stop()))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    commit()
    window.location.reload()
  } catch (error) {
    for (const entry of active) entry.resume()
    throw error
  } finally {
    reloading = false
  }
}
