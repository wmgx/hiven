/** Always release the native ResourceTable entry, including failed/cancelled reads. */
export async function withImageHandle<H extends { close(): Promise<void> }, T>(
  handle: H,
  use: (handle: H) => Promise<T>,
): Promise<T> {
  try {
    return await use(handle)
  } finally {
    await handle.close().catch(() => undefined)
  }
}
