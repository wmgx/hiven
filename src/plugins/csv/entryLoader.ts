/** A failed Vite CSS preload occurs before the module import is invoked. */
export class EntryStylesheetError extends Error {
  readonly link: HTMLLinkElement
  constructor(link: HTMLLinkElement) {
    super('Entry stylesheet could not be loaded')
    this.link = link
  }
}

export function identifyStylesheetFailure(error: unknown, document: Document): EntryStylesheetError | undefined {
  if (!(error instanceof Error)) return
  const prefix = 'Unable to preload CSS for '
  if (!error.message.startsWith(prefix)) return
  const path = error.message.slice(prefix.length)
  // Only an existing stylesheet requested by this document, never a supplied URL.
  const link = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .find(link => link.getAttribute('href') === path)
  if (!link || new URL(link.href).origin !== new URL(document.baseURI).origin) return
  return new EntryStylesheetError(link)
}

export function reloadStylesheet(failed: HTMLLinkElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = failed.cloneNode(false) as HTMLLinkElement
    let timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error) => {
      clearTimeout(timer)
      link.onload = link.onerror = null
      if (error) { link.remove(); reject(error) }
      else { failed.remove(); resolve() }
    }
    link.onload = () => finish()
    link.onerror = () => finish(new EntryStylesheetError(failed))
    timer = setTimeout(() => finish(new EntryStylesheetError(failed)), 15000)
    try { failed.ownerDocument.head.appendChild(link) }
    catch { finish(new EntryStylesheetError(failed)) }
  })
}

export function createEntryLoader<T>(load: () => Promise<T>, classify: (error: unknown) => EntryStylesheetError | undefined,
  repair: (link: HTMLLinkElement) => Promise<void> = reloadStylesheet) {
  let result: Promise<T> | undefined
  let failure: EntryStylesheetError | undefined
  let retry: Promise<T> | undefined
  const read = () => result ??= load().catch(error => {
    failure = classify(error)
    throw failure ?? error
  })
  return {
    read,
    retry() {
      if (retry) return retry
      if (!failure) return read()
      // Rebuild the failed resource before allowing Vite's already-seen cache to
      // skip it. The unchanged module URL has not been imported on this path.
      retry = repair(failure.link).then(() => {
        failure = undefined
        result = undefined
        return read()
      }).finally(() => { retry = undefined })
      return retry
    },
  }
}
