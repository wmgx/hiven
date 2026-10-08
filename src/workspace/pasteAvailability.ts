/** A preflight check, not a guarantee that a later paste will succeed. */
export type PasteAvailability = 'unsupported' | 'accessibility-required' | 'can-attempt' | 'unknown'

async function queryPasteAvailability(): Promise<PasteAvailability> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const availability = await invoke<unknown>('get_paste_availability')
    if (availability === 'unsupported' || availability === 'accessibility-required' || availability === 'can-attempt') {
      return availability
    }
  } catch {
    // Older native hosts and unavailable transports retain the existing attempt
    // path. Unknown must not be presented as confirmed paste support.
  }
  return 'unknown'
}

export async function readPasteAvailability(): Promise<PasteAvailability> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      queryPasteAvailability(),
      new Promise<PasteAvailability>((resolve) => {
        timeout = setTimeout(() => resolve('unknown'), 300)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export function pasteAvailabilityMessageKey(availability: PasteAvailability) {
  if (availability === 'unsupported') return 'workspace.paste.unsupported'
  if (availability === 'accessibility-required') return 'workspace.paste.permissionRequired'
  return undefined
}
