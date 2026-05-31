export const DEFAULT_GLOBAL_SHORTCUT = 'Shift+Space'
export const LEGACY_GLOBAL_SHORTCUTS = ['CmdOrCtrl+Shift+Space', 'Ctrl+Space']

let registeredShortcut: string | null = null

export function normalizeGlobalShortcut(value: string): string {
  return value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+')
}

export async function triggerGlobalLaunch() {
  if (!(window as any).__TAURI_INTERNALS__) return

  const { Window } = await import('@tauri-apps/api/window')
  const main = await Window.getByLabel('main')
  const launcher = await Window.getByLabel('launcher')
  if (!launcher) return

  await main?.hide()
  await launcher.center()
  await launcher.show()
  await launcher.unminimize()
  await launcher.setFocus()
  await launcher.emit('fluxtext://global-launch')
}

export async function hideMainWindow() {
  if (!(window as any).__TAURI_INTERNALS__) return

  const { Window } = await import('@tauri-apps/api/window')
  await Window.getByLabel('main').then((window) => window?.hide())
}

export async function openResultInMainWindow(text: string, actionName: string) {
  if (!(window as any).__TAURI_INTERNALS__) return

  const { emitTo } = await import('@tauri-apps/api/event')
  const { Window } = await import('@tauri-apps/api/window')
  const main = await Window.getByLabel('main')
  if (!main) return

  await emitTo('main', 'fluxtext://launcher-result', { text, actionName })
  await main.show()
  await main.unminimize()
  await main.setFocus()
}

export async function registerGlobalShortcut(shortcut: string) {
  if (!(window as any).__TAURI_INTERNALS__) return

  const nextShortcut = normalizeGlobalShortcut(shortcut)
  if (!nextShortcut) {
    throw new Error('Shortcut is required')
  }
  if (registeredShortcut === nextShortcut) return

  const { register, unregister } = await import('@tauri-apps/plugin-global-shortcut')
  const previousShortcut = registeredShortcut
  if (previousShortcut) {
    await unregister(previousShortcut).catch(() => undefined)
    registeredShortcut = null
  }

  try {
    await register(nextShortcut, (event) => {
      if (event.state === 'Pressed') {
        triggerGlobalLaunch().catch((e) => console.error('[FluxText] Failed to trigger global launch:', e))
      }
    })
    registeredShortcut = nextShortcut
  } catch (e) {
    if (previousShortcut) {
      await register(previousShortcut, (event) => {
        if (event.state === 'Pressed') {
          triggerGlobalLaunch().catch((err) => console.error('[FluxText] Failed to trigger global launch:', err))
        }
      }).then(() => {
        registeredShortcut = previousShortcut
      }).catch(() => {
        registeredShortcut = null
      })
    }
    throw e
  }
}

export async function unregisterGlobalShortcut() {
  if (!(window as any).__TAURI_INTERNALS__ || !registeredShortcut) return

  const { unregister } = await import('@tauri-apps/plugin-global-shortcut')
  const shortcut = registeredShortcut
  registeredShortcut = null
  await unregister(shortcut).catch(() => undefined)
}
