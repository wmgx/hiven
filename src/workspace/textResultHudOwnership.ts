type Owner = { key: symbol; cancel: () => Promise<void> }

let owner: Owner | null = null
let queue: Promise<void> = Promise.resolve()

/** Serialize products sharing the one native text-result HUD. */
export function claimTextResultHud(key: symbol, cancel: () => Promise<void>): Promise<void> {
  const claim = queue.catch(() => undefined).then(async () => {
    if (owner && owner.key !== key) await owner.cancel().catch(() => undefined)
    owner = { key, cancel }
  })
  queue = claim
  return claim
}

export function releaseTextResultHud(key: symbol): void {
  if (owner?.key === key) owner = null
}
