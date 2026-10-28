import { useEffect, useMemo, useRef, useState } from 'react'
import { t, type Locale } from '../../i18n'
import { useAppStore } from '../../store'
import { createPluginSurfaceTextSaver } from '../../workspace/pluginSurfaceTextSave'
import { acquireLauncherNativeDialogFocus } from '../../workspace/launcherBlurGuard'
import { isNativeDesktopRuntime } from '../../workspace/webNativeBridge'
import { showToast } from '../../workspace/toast'
import type { LauncherCommandMenuAction } from './LauncherCommandFooter'

/** A save chooser belongs to this exact visible result and is revoked on replacement. */
export function useCommandMenuActions(text: string | null, commandKey: string | undefined, locale: Locale): LauncherCommandMenuAction[] {
  const [save] = useState(createPluginSurfaceTextSaver)
  const keys = useAppStore(state => state.launcherFavoriteKeys)
  const active = useRef<object | null>(null)
  const owner = useMemo(() => {
    const listeners = new Set<() => void>()
    const token = {}
    return { token, isCurrent: () => active.current === token,
      subscribeInvalidation: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      invalidate: () => { if (active.current === token) active.current = null; for (const listener of listeners) listener() },
    }
  }, [text, commandKey])
  useEffect(() => { active.current = owner.token; return owner.invalidate }, [owner])
  return [
    ...(text !== null && isNativeDesktopRuntime() ? [{ id: 'save-as', label: t(locale, 'outputActions.saveAs'), run: async () => {
      try { await save(text, undefined, { owner, dialogTitle: t(locale, 'outputActions.saveAs'), acquireFocusLease: acquireLauncherNativeDialogFocus }) }
      catch (error) { if (owner.isCurrent() && (error as Error).name !== 'AbortError') showToast(t(locale, 'palette.currentTextExportFailed'), 'error') }
    } }] : []),
    ...(commandKey ? [{ id: 'pin', label: t(locale, keys.includes(commandKey) ? 'palette.actionUnpin' : 'palette.actionPin'), run: () => {
      try { useAppStore.getState().toggleLauncherFavorite(commandKey, !keys.includes(commandKey)) }
      catch { showToast(t(locale, 'palette.favoriteSaveFailed'), 'error') }
    } }] : []),
  ]
}
