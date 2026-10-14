type Owner = { key: symbol; generation: symbol; cancel: () => Promise<void> }

export type TextResultHudLease = {
  isCurrent(): boolean
  release(): void
}

export type TextResultHudClaim = {
  acquired: Promise<TextResultHudLease | null>
  cancel(): void
}

let owner: Owner | null = null
let queue: Promise<void> = Promise.resolve()

/** Serialize products sharing one native HUD; pending and superseded claims are revocable. */
export function claimTextResultHud(key: symbol, cancelOwner: () => Promise<void>): TextResultHudClaim {
  const generation = Symbol('text-result-hud-lease')
  let cancelled = false
  const acquired = queue.catch(() => undefined).then(async (): Promise<TextResultHudLease | null> => {
    if (cancelled) return null
    const previous = owner
    if (previous && previous.key !== key) await previous.cancel().catch(() => undefined)
    if (cancelled) return null
    owner = { key, generation, cancel: cancelOwner }
    return {
      isCurrent: () => owner?.generation === generation,
      release: () => {
        if (owner?.generation === generation) owner = null
      },
    }
  })
  queue = acquired.then(() => undefined)
  return {
    acquired,
    cancel: () => {
      cancelled = true
      if (owner?.generation === generation) owner = null
    },
  }
}
