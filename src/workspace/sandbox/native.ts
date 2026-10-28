import { createSandboxStorage } from './storage'

type Args = Record<string, any>
type Clipboard = { kind: 'text' | 'image' | 'files' | 'empty'; text: string; image?: number; files: string[]; changeCount: number; origin: 'hiven' | null; concealed: boolean; transient: boolean; recordInHistory: boolean }
const changeEvent = 'hiven:sandbox-change'
const changed = () => window.dispatchEvent(new Event(changeEvent))
let clipboard: Clipboard = { kind: 'empty', text: '', files: [], changeCount: 0, origin: null, concealed: false, transient: false, recordInHistory: true }
let editor = { text: '', selection: { start: 0, end: 0 } }
let visible = true
let surfaceWindow: Args | null = null
let launcherSize: Args | null = null
let dragCount = 0
let serial = 0
let revision = 0
let modifier = ''
let locale: 'en' | 'zh' = 'en'
const callbacks = new Map<number, { callback: (value: any) => void; once: boolean }>()
const listeners = new Map<number, { event: string; handler: number }>()
const shortcuts = new Map<string, { key: string; handler: { onmessage: (value: any) => void } }>()
const occupied = new Set<string>()
const toasts = new Map<string, Args>()
const attempts = new Set<string>()
const images = new Map<number, { rgba: Uint8Array; width: number; height: number }>()
const commands = new Set<string>()
const blocked = new Set<string>()
const storage = createSandboxStorage()
const normalize = (key: string) => key.replace(/CommandOrControl|CmdOrControl|Cmd|Meta/g, 'Command').replace(/Ctrl/g, 'Control').replace(/Alt/g, 'Option').toLowerCase().split('+').sort().join('+')
const appName = async () => (await import('../../i18n')).translate(locale, 'sandbox', 'editor')
function runCallback(id: number, value: unknown) { const entry = callbacks.get(id); entry?.callback(value); if (entry?.once) callbacks.delete(id) }
function emit(event: string, payload?: unknown) { for (const [id, listener] of listeners) if (listener.event === event) runCallback(listener.handler, { event, id, payload }) }
function updateClipboard(value: Partial<Clipboard>) {
  clipboard = { kind: 'text', text: '', files: [], origin: 'hiven', concealed: false, transient: false, recordInHistory: true, ...value, changeCount: clipboard.changeCount + 1 }
  changed()
}
function paste(text: string) {
  const start = editor.selection.start
  editor = { text: editor.text.slice(0, start) + text + editor.text.slice(editor.selection.end), selection: { start: start + text.length, end: start + text.length } }
  visible = false
  changed()
}
function hudUpdate() {
  for (const [slot, toast] of toasts) if (toast.expiresAt <= Date.now()) toasts.delete(slot)
  return { revision: ++revision, toasts: [...toasts.values()] }
}
function publishHud() { emit('hiven://hud-toast', hudUpdate()); changed() }
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return { get length() { return data.size }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(String(key), String(value)) }, removeItem: key => { data.delete(key) }, clear: () => data.clear() }
}

async function invoke(command: string, args: Args = {}, options?: Args): Promise<any> {
  commands.add(command)
  if (command.startsWith('plugin_kv_') || command.startsWith('plugin_blob_') || ['init_config_dir', 'get_config_dir', 'save_plugin_file', 'read_plugin_file', 'list_plugin_dirs', 'list_plugin_files', 'remove_plugin_dir'].includes(command)) return storage(command, args, options)
  switch (command) {
    case 'plugin:event|listen': { const id = ++serial; listeners.set(id, { event: args.event, handler: args.handler }); return id }
    case 'plugin:event|unlisten': listeners.delete(args.eventId); return
    case 'plugin:event|emit': case 'plugin:event|emit_to': emit(args.event, args.payload); return
    case 'clipboard_change_count': return clipboard.changeCount
    case 'clipboard_origin': if (args.expectedCount !== clipboard.changeCount) throw new Error('ClipboardChanged'); return clipboard.origin
    case 'clipboard_read_public_text': return clipboard.concealed || clipboard.transient ? '' : clipboard.text
    case 'clipboard_read_history_text': return clipboard.concealed || clipboard.transient || !clipboard.recordInHistory ? '' : clipboard.text
    case 'read_clipboard_file_paths': return clipboard.concealed || clipboard.transient ? [] : [...clipboard.files]
    case 'clipboard_write_text': updateClipboard({ text: args.text, recordInHistory: args.recordInHistory !== false }); return
    case 'clipboard_write_sensitive_text': case 'clipboard_write_login_link': updateClipboard({ text: args.text ?? args.url, concealed: true, transient: true }); return
    case 'write_clipboard_file_paths': updateClipboard({ kind: 'files', text: args.paths.join('\n'), files: [...args.paths] }); return
    case 'clipboard_read_image': if (clipboard.kind !== 'image' || clipboard.concealed || clipboard.transient) throw new Error('ClipboardImageMissing'); return clipboard.image
    case 'clipboard_write_image': if (!images.has(args.image)) throw new Error('SandboxImageMissing'); updateClipboard({ kind: 'image', image: args.image }); return
    case 'plugin:image|new': { const id = ++serial; images.set(id, { rgba: new Uint8Array(args.rgba), width: args.width, height: args.height }); return id }
    case 'plugin:image|from_bytes': {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(args.bytes)]))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const id = ++serial; images.set(id, { rgba: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data), width: bitmap.width, height: bitmap.height }); bitmap.close(); return id
    }
    case 'plugin:image|size': { const image = images.get(args.rid)!; return { width: image.width, height: image.height } }
    case 'plugin:image|rgba': return images.get(args.rid)?.rgba
    case 'plugin:resources|close': if (args.rid !== clipboard.image) images.delete(args.rid); return
    case 'get_paste_availability': return 'can-attempt'
    case 'begin_paste_attempt': case 'begin_history_queue_paste': {
      if (command === 'begin_history_queue_paste' && visible) throw new Error('QueueTargetError')
      const id = crypto.randomUUID(); attempts.add(id); return id }
    case 'cancel_paste_attempt': attempts.delete(args.attemptId); return
    case 'hide_launcher_and_paste': if (!attempts.has(args.attemptId)) throw new Error('PasteCancelled'); paste(clipboard.text || clipboard.files.join('\n')); return
    case 'paste_history_queue_text': {
      if (!attempts.has(args.attemptId)) throw new Error('QueueTargetError')
      const backup = structuredClone(clipboard)
      updateClipboard({ text: args.text, transient: true, concealed: true })
      try { paste(clipboard.text) } finally { updateClipboard({ ...backup, origin: 'hiven' }) }
      return
    }
    case 'plugin:global-shortcut|register': {
      if (args.shortcuts.some((key: string) => occupied.has(normalize(key)) || shortcuts.has(normalize(key)))) throw new Error('ShortcutOccupied')
      for (const key of args.shortcuts) shortcuts.set(normalize(key), { key, handler: args.handler })
      changed(); return
    }
    case 'plugin:global-shortcut|unregister': for (const key of args.shortcuts) shortcuts.delete(normalize(key)); changed(); return
    case 'plugin:global-shortcut|unregister_all': shortcuts.clear(); changed(); return
    case 'plugin:global-shortcut|is_registered': return shortcuts.has(normalize(args.shortcut))
    case 'register_double_modifier_hotkey': modifier = args.modifier; return { status: 'registered' }
    case 'unregister_double_modifier_hotkey': modifier = ''; return
    case 'current_foreground_app_name': return appName()
    case 'current_foreground_app_context': return { appName: await appName(), processId: 1 }
    case 'show_launcher_window': surfaceWindow = null; visible = true; emit('hiven://launcher-open', {}); changed(); return
    case 'hide_launcher_window': visible = false; changed(); return
    case 'show_plugin_surface_window': {
      surfaceWindow = { ...args, key: ++serial }
      const url = new URL(location.href)
      for (const key of ['pluginId', 'surfaceId', 'source']) url.searchParams.set(key, args[key])
      history.replaceState(null, '', url)
      visible = true; changed(); return
    }
    case 'hide_plugin_surface_window': surfaceWindow = null; visible = false; changed(); return
    case 'plugin_surface_handoff_peek': return null
    case 'plugin_surface_draft_report': return
    case 'plugin:window|start_dragging': dragCount++; return
    case 'route_toast':
      if (visible) return 'launcher'
      toasts.set(args.slot ?? 'flash', { ...args, owner: 'launcher' }); publishHud(); return null
    case 'dismiss_toast': for (const [slot, toast] of toasts) if (toast.id === args.id) toasts.delete(slot); publishHud(); return
    case 'hud_ready': return hudUpdate()
    case 'hud_status_action': {
      const toast = [...toasts.values()].find(toast => toast.id === args.id && toast.interactive)
      if (!toast || args.action !== 'cancel') throw new Error('hud-unavailable')
      emit('hiven://toast-control', { id: args.id, action: args.action }); return
    }
    case 'capture_hud_target': return null
    case 'plugin:window|is_visible': return visible
    case 'plugin:window|is_focused': return visible
    case 'plugin:window|scale_factor': return 1
    case 'plugin:window|inner_size': case 'plugin:window|outer_size': return { width: 704, height: 700 }
    case 'plugin:window|inner_position': case 'plugin:window|outer_position': return { x: 0, y: 0 }
    case 'plugin:window|current_monitor': case 'plugin:window|primary_monitor': return { name: 'sandbox', size: { width: 1440, height: 900 }, position: { x: 0, y: 0 }, scaleFactor: 1 }
    case 'plugin:window|get_all_windows': return ['launcher']
    case 'get_launcher_window_resize_session': return { session: 1, revision: 0 }
    case 'configure_launcher_window': launcherSize = structuredClone(args.request); changed(); return true
    case 'plugin:app|version': return '0.0.0'
    case 'plugin:app|name': return 'hiven'
    case 'plugin:path|resolve_directory': return '/sandbox'
    case 'set_context_suggestions_enabled': case 'restore_launcher_input_source': case 'focus_launcher_webview':
    case 'append_launcher_perf_log': case 'ai_usage_record_upsert': case 'plugin:app|set_app_theme': return
    case 'list_desktop_windows': case 'ai_usage_query': case 'discover_installed_apps': case 'list_desktop_bridge_history': case 'list_desktop_bridge_targets': case 'surface_registry_snapshot': return []
    case 'desktop_bridge_status': return { running: false, port: 0, sources: [] }
    case 'get_desktop_window_platform': return 'macos'
    case 'launcher_perf_log_file': return '/sandbox/launcher-perf.ndjson'
    case 'surface_registry_upsert': case 'surface_registry_mark_state': case 'surface_registry_remove':
    case 'usage_journal_append': case 'set_desktop_bridge_source_config': case 'log_launcher_perf_frontend': return
  }
  if (command.startsWith('plugin:window|set_')) return
  blocked.add(command)
  throw new Error(`SandboxUnsupported:${command}`)
}

export const sandbox = {
  copy(text: string) { updateClipboard({ text, origin: null }) },
  clipboard: () => structuredClone(clipboard),
  editor: () => structuredClone(editor),
  setEditor(text: string, selection = { start: text.length, end: text.length }) {
    const start = Math.max(0, Math.min(text.length, selection.start)); const end = Math.max(start, Math.min(text.length, selection.end))
    editor = { text, selection: { start, end } }; changed()
  },
  async pressShortcut(accelerator: string, state?: 'Pressed' | 'Released') {
    const registered = shortcuts.get(normalize(accelerator))
    for (const phase of state ? [state] : ['Pressed', 'Released']) registered?.handler.onmessage({ shortcut: registered.key, id: 0, state: phase })
    if (modifier && accelerator === modifier) emit('hiven://route-global-pinned-launcher-shortcut')
  },
  occupyShortcut(accelerator: string) { occupied.add(normalize(accelerator)) },
  toasts: () => structuredClone(hudUpdate().toasts),
  surfaceWindow: () => surfaceWindow,
  launcherSize: () => structuredClone(launcherSize),
  dragCount: () => dragCount,
  async surfaces() {
    const { pluginRegistry } = await import('../pluginRegistry')
    return pluginRegistry.getAllPluginDefinitions().flatMap(({ definition, pluginId }) => (definition.ui?.surfaces ?? []).map(surface => ({ pluginId, surfaceId: surface.id, source: 'builtin', title: surface.title, titleI18n: surface.titleI18n, shell: surface.shell })))
  },
  async openSurface(target: { pluginId: string; surfaceId: string; source: 'builtin'; initialText?: string }, presentation: 'inline' | 'window' = 'inline') {
    if (presentation === 'window') {
      const { requestOpenPluginSurfaceWindow } = await import('../pluginSurfaceWindows')
      await requestOpenPluginSurfaceWindow(target)
    } else {
      surfaceWindow = null
      const { useAppStore } = await import('../../store')
      await sandbox.open()
      useAppStore.getState().openPluginSurfaceTool(target)
    }
    changed()
  },
  async openSettings(pluginId?: string) {
    await sandbox.open()
    if (pluginId) {
      const { usePluginSettingsStore } = await import('../pluginSettingsStore')
      usePluginSettingsStore.getState().openSettingsDialog({ pluginId, source: 'builtin', presentation: 'dialog' })
    } else {
      const { useAppStore } = await import('../../store')
      useAppStore.getState().openLauncherHostSurface('system-ai-settings')
    }
  },
  async appearance(theme: 'light' | 'dark', language: 'en' | 'zh') {
    const { useAppStore } = await import('../../store')
    useAppStore.getState().setLocale(language)
    useAppStore.getState().updateSetting('theme', theme)
  },
  copyImage() { const id = ++serial; images.set(id, { rgba: new Uint8Array([64, 128, 192, 255]), width: 1, height: 1 }); updateClipboard({ kind: 'image', image: id, origin: null }) },
  surfaceToasts: () => [...document.querySelectorAll('.surface-toast')].map(node => ({ message: node.querySelector('span')?.textContent, level: (node as HTMLElement).dataset.level, actions: [...node.querySelectorAll('button')].map(button => button.textContent || button.getAttribute('aria-label')) })),
  async snapshot() {
    const { getPasteQueueDebugSnapshot } = await import('../../shortcutHosts/pasteQueue')
    return { queue: getPasteQueueDebugSnapshot(), shortcuts: [...shortcuts.values()].map(({ key }) => key), toasts: sandbox.toasts(), commands: [...commands].sort(), blocked: [...blocked].sort(), visible }
  },
  open: () => invoke('show_launcher_window'),
  launcherVisible: () => visible,
  focusEditor: () => invoke('hide_launcher_window'),
  setLocale(value: 'en' | 'zh') { locale = value },
  subscribe(listener: () => void) { window.addEventListener(changeEvent, listener); return () => window.removeEventListener(changeEvent, listener) },
}

declare global { interface Window { __HIVEN_SANDBOX__?: boolean; __hivenSandbox?: typeof sandbox } }

export function installSandbox() {
  window.__HIVEN_SANDBOX__ = true
  window.__hivenSandbox = sandbox
  document.documentElement.dataset.sandbox = 'true'
  Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true })
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true })
  Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: { readText: async () => clipboard.text, writeText: async (text: string) => updateClipboard({ text }), read: async () => [], write: async () => { throw new Error('SandboxUseNativeImage') } }, configurable: true })
  localStorage.setItem('hiven-plugin-settings', JSON.stringify({ state: { pluginSettings: { builtin: { 'clipboard-history': { version: 2, value: { enabled: true } } }, installed: {}, dev: {} } }, version: 0 }))
  localStorage.setItem('hiven-settings', JSON.stringify({ state: { settings: { aiDefaultProviderId: 'sandbox', aiDefaultAgentId: 'sandbox-text' } }, version: 1 }))
  const fetchResource = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url, location.href)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (url.origin !== location.origin || method !== 'GET' || !/^\/(?:src\/|@|node_modules\/|assets\/|$)/.test(url.pathname)) return Promise.reject(new Error('SandboxNetworkBlocked'))
    return fetchResource(input, init)
  }
  document.addEventListener('copy', event => {
    if (event.defaultPrevented) return
    event.preventDefault()
    const target = document.activeElement
    const text = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
      ? target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0) : window.getSelection()?.toString() ?? ''
    sandbox.copy(text)
  })
  document.addEventListener('cut', event => { event.preventDefault() })
  // Native paste events may contain the system clipboard; substitute memory before app handlers.
  const pasteMemory = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return
    const data = new DataTransfer(); data.setData('text/plain', clipboard.text)
    if (!target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))) return
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const start = target.selectionStart ?? 0
      const value = target.value.slice(0, start) + clipboard.text + target.value.slice(target.selectionEnd ?? start)
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value)
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.setSelectionRange(start + clipboard.text.length, start + clipboard.text.length)
    }
  }
  document.addEventListener('paste', event => {
    if (!event.isTrusted) return
    event.preventDefault(); event.stopImmediatePropagation(); pasteMemory(event.target)
  }, true)
  window.addEventListener('keydown', event => {
    if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault(); pasteMemory(event.target)
    }
  })
  ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke, transformCallback(callback = () => {}, once = false) { const id = ++serial; callbacks.set(id, { callback, once }); return id },
    unregisterCallback: (id: number) => callbacks.delete(id), runCallback, convertFileSrc: (path: string) => path.startsWith('blob:') ? path : '',
    metadata: { currentWindow: { label: 'launcher' }, currentWebview: { label: 'launcher', windowLabel: 'launcher' } }, plugins: { path: { sep: '/', delimiter: ':' } },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => { listeners.delete(id) } }
}
