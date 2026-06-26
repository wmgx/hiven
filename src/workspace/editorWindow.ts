import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize } from '@tauri-apps/api/window'

const EDITOR_WINDOW_LABEL = 'editor'
const EDITOR_WINDOW_WIDTH = 1100
const EDITOR_WINDOW_HEIGHT = 720

export async function requestOpenEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return

  const existing = await WebviewWindow.getByLabel(EDITOR_WINDOW_LABEL).catch(() => null)
  if (existing) {
    await existing.setSize(new LogicalSize(EDITOR_WINDOW_WIDTH, EDITOR_WINDOW_HEIGHT)).catch(() => undefined)
    await existing.show().catch(() => undefined)
    await existing.setFocus().catch(() => undefined)
    return
  }

  const win = new WebviewWindow(EDITOR_WINDOW_LABEL, {
    url: 'index.html?window=editor',
    title: 'Hiven Editor',
    width: EDITOR_WINDOW_WIDTH,
    height: EDITOR_WINDOW_HEIGHT,
    minWidth: 800,
    minHeight: 500,
    decorations: false,
    transparent: false,
    resizable: true,
    focus: true,
    skipTaskbar: false,
  })

  window.setTimeout(() => {
    void win.center().catch(() => undefined)
    void win.setFocus().catch(() => undefined)
  }, 60)
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
