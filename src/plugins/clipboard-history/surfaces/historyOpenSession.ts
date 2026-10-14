export function createHistoryOpenSession(initialVisibility: DocumentVisibilityState) {
  let hidden = initialVisibility === 'hidden'

  return {
    visibilityChanged(visibility: DocumentVisibilityState): boolean {
      const nextHidden = visibility === 'hidden'
      const reopened = hidden && !nextHidden
      hidden = nextHidden
      return reopened
    },
  }
}

type HistoryOpenSessionReset = {
  invalidatePasteNotice(): void
  clearPasteNotice(): void
  clearSelection(): void
  resetPage(): void
  clearNextCursor(): void
  resetScroll(): void
  clearDomSelection(): void
  suspendPointerHover(): void
  refreshPage(): void
  focusSearch(): void
}

export function resetHistoryOpenSession(actions: HistoryOpenSessionReset): void {
  actions.invalidatePasteNotice()
  actions.clearPasteNotice()
  actions.clearSelection()
  actions.resetPage()
  actions.clearNextCursor()
  actions.resetScroll()
  actions.clearDomSelection()
  actions.suspendPointerHover()
  actions.refreshPage()
  actions.focusSearch()
}
