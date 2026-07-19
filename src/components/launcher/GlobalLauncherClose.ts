import { hideLauncherWindow, restoreCurrentLauncherOverlayWindow } from '../../workspace/windowManager/launcherWindow'

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
      await restoreCurrentLauncherOverlayWindow({ hide: hideOverlayWindow })
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
