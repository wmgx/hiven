type SearchPage<T> = { items: T[]; nextCursor?: string; scanned: number }

/** Traverse empty search pages without retaining candidates or full bodies. */
export async function readMatchingHistoryPage<T>(
  read: (cursor?: string) => Promise<SearchPage<T>>,
  initialCursor: string | undefined,
  signal: AbortSignal,
  progress: (scanned: number) => void,
): Promise<SearchPage<T>> {
  let cursor = initialCursor
  let scanned = 0
  do {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const page = await read(cursor)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    scanned += page.scanned
    progress(scanned)
    if (page.items.length || !page.nextCursor) return { ...page, scanned }
    if (page.nextCursor === cursor) throw new Error('history page did not advance')
    cursor = page.nextCursor
  } while (true)
}
