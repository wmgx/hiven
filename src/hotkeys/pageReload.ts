type ReloadParticipant = {
  stop: () => Promise<void>
  resume: () => void
}

const participants = new Map<string, ReloadParticipant>()
let reloading = false

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
