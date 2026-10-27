const reasonCodes = new Set([
  'QueueTargetError', 'QueuePermissionError', 'QueueUnavailableError', 'QueueSnapshotError',
  'QueuePlatformUnavailableError', 'QueueDeliveryError', 'QueueClipboardError',
  'hud-unavailable',
])

/** Diagnostics retain identifiers and fixed codes, never native error messages or IPC arguments. */
export function createNativeDiagnostics() {
  const errors: Array<{ ts: number; source: string; code: string }> = []
  const registrationFailures = new Map<string, string>()
  return {
    record(command: string, error: unknown, accelerators: string[] = []) {
      const code = reasonCodes.has(String(error)) ? String(error) : 'NativeCommandFailed'
      errors.push({ ts: Date.now(), source: /^[a-z_:|\-]+$/.test(command) ? command : 'native', code })
      if (errors.length > 20) errors.shift()
      if (command === 'plugin:global-shortcut|register') {
        for (const accelerator of accelerators) registrationFailures.set(accelerator, 'ShortcutRegistrationFailed')
      }
    },
    errors: () => errors.slice(),
    registrationFailure: (accelerator: string) => registrationFailures.get(accelerator) ?? null,
  }
}

export const nativeDiagnostics = createNativeDiagnostics()

export async function installNativeDebugSnapshot(): Promise<void> {
  if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ || window.__HIVEN_WEB_NATIVE_BRIDGE__ || window.__HIVEN_SANDBOX__) return
  const { emit, listen } = await import('@tauri-apps/api/event')
  const diagnostics = nativeDiagnostics
  await listen<number>('hiven://debug-snapshot-request', async ({ payload: requestId }) => {
    const [{ useAppStore }, { usePluginSurfaceShortcutStore }, { getPasteQueueDebugSnapshot }] = await Promise.all([
      import('../store'), import('./pluginSurfaceShortcuts'), import('../shortcutHosts/pasteQueue'),
    ])
    const settings = useAppStore.getState().settings
    const shortcuts: Array<{ role: string; kind: string; key: string; failure: string | null }> = []
    for (const role of ['globalPinnedLauncherShortcut', 'quickEditorShortcut', 'pasteQueueShortcut'] as const) {
      const configured = settings[role]
      const key = configured.kind === 'accelerator' ? configured.accelerator : configured.kind === 'double-modifier' ? configured.modifier : ''
      shortcuts.push({ role, kind: configured.kind, key, failure: diagnostics.registrationFailure(key)
        ?? (configured.registrationError ? 'ShortcutRegistrationFailed' : null) })
    }
    for (const [index, configured] of settings.appHotkeys.entries()) {
      shortcuts.push({ role: `app:${index}`, kind: 'accelerator', key: configured.accelerator, failure: diagnostics.registrationFailure(configured.accelerator) })
    }
    for (const [index, configured] of Object.values(usePluginSurfaceShortcutStore.getState().shortcuts).entries()) {
      shortcuts.push({ role: `surface:${index}`, kind: configured.enabled ? 'accelerator' : 'disabled', key: configured.accelerator,
        failure: diagnostics.registrationFailure(configured.accelerator) ?? (configured.registrationError ? 'ShortcutRegistrationFailed' : null) })
    }
    await emit('hiven://debug-snapshot-response', { requestId, shortcuts, queue: getPasteQueueDebugSnapshot(), errors: diagnostics.errors() })
  })
}
