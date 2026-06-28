import { hideLauncherWindow } from '../../workspace/windowManager/launcherWindow'

export async function closeGlobalLauncherWindow({
  standaloneLauncher,
  overlay,
  hideOverlayWindow,
  restoreFocus,
  setOpen,
}: {
  standaloneLauncher: boolean
  overlay: boolean
  hideOverlayWindow: boolean
  restoreFocus: () => void
  setOpen: (open: boolean) => void
}) {
  if (standaloneLauncher) {
    try {
      await hideLauncherWindow()
    } catch (error) {
      console.warn('[hiven] Failed to hide launcher window:', error)
    }
    setOpen(false)
    restoreFocus()
    return
  }

  if (overlay) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.setDecorations(true)
      if (hideOverlayWindow) await win.hide()
    } catch (error) {
      console.warn('[hiven] Failed to restore launcher window:', error)
    }
    setOpen(false)
    restoreFocus()
    return
  }

  setOpen(false)
  restoreFocus()
}

export async function finishPinnedLauncherSelection({
  pinnedId,
  standaloneLauncher,
  overlay,
  openPinnedAction,
  restoreFocus,
  setOpen,
}: {
  pinnedId: string
  standaloneLauncher: boolean
  overlay: boolean
  openPinnedAction: (pinnedId: string) => void
  restoreFocus: () => void
  setOpen: (open: boolean) => void
}) {
  if (standaloneLauncher) {
    try {
      openPinnedAction(pinnedId)
      await hideLauncherWindow()
    } catch (error) {
      console.warn('[hiven] Failed to select launcher item:', error)
    }
    setOpen(false)
    restoreFocus()
    return
  }

  if (overlay) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.setDecorations(true)
    } catch (error) {
      console.warn('[hiven] Failed to restore launcher window:', error)
    }
    setOpen(false)
    restoreFocus()
    openPinnedAction(pinnedId)
    return
  }

  setOpen(false)
  restoreFocus()
  openPinnedAction(pinnedId)
}
