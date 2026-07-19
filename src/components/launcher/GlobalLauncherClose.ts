import {
  hideLauncherWindow,
  restoreCurrentLauncherOverlayWindow,
  type RestoreForegroundMode,
} from '../../workspace/windowManager/launcherWindow'

export async function closeGlobalLauncherWindow({
  standaloneLauncher,
  overlay,
  hideOverlayWindow,
  restoreFocus,
  setOpen,
  restoreForeground = 'auto',
}: {
  standaloneLauncher: boolean
  overlay: boolean
  hideOverlayWindow: boolean
  restoreFocus: () => void
  setOpen: (open: boolean) => void
  /**
   * Host hide policy for the remembered previous app.
   * Blur-dismiss should pass `never`; Esc / idle close use `auto`.
   * Clipboard paste does not use this path — it calls hide_launcher_and_paste.
   */
  restoreForeground?: RestoreForegroundMode
}) {
  if (standaloneLauncher) {
    try {
      await hideLauncherWindow({ restoreForeground })
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
