export type DiffCopySide = 'original' | 'modified'

/** One clipboard writer per surface: both sides share the non-cancellable write lock. */
export function createDiffSideCopier() {
  let revision = 0
  let pending = false

  return {
    getRevision: () => revision,
    invalidate() {
      // A hidden window can reopen. Revoke old buttons/results, not future copies,
      // and never release a system write that is still in flight.
      return ++revision
    },
    async copy(
      request: { side: DiffCopySide; text: string; revision: number },
      writeText: (text: string) => Promise<void>,
      onPendingChange: (side: DiffCopySide | null) => void,
      onResult: (success: boolean) => void,
    ): Promise<void> {
      if (request.revision !== revision || pending || request.text.length === 0) return
      const { side, text, revision: requestRevision } = request
      pending = true
      onPendingChange(side)
      let success = false
      try {
        // Capture the complete current draft before awaiting; preserve every byte.
        await writeText(text)
        success = true
      } catch {
        // Permission denial and host failures leave both drafts untouched.
      } finally {
        pending = false
        onPendingChange(null)
      }
      if (requestRevision === revision) onResult(success)
    },
  }
}
