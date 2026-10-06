const BRIDGE_BASE = 'http://127.0.0.1:19246/v1/validation'
const ACTIVE_RELAY_POLL_MS = 20
// Idle desktop polling must stay well under the browser's 1s storage-snapshot timeout.
const IDLE_RELAY_POLL_MS = 250

type BridgeInternals = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  transformCallback: (callback?: (payload: unknown) => void, once?: boolean) => number
  unregisterCallback: (id: number) => void
  runCallback: (id: number, payload: unknown) => void
  convertFileSrc: (path: string) => string
  metadata: {
    currentWindow: { label: string }
    currentWebview: { label: string; windowLabel: string }
  }
  plugins: { path: { sep: string; delimiter: string } }
}

type RelayRequest = { id: string; clientId: string; command: string; args?: Record<string, unknown> }

declare global {
  interface Window {
    __HIVEN_WEB_NATIVE_BRIDGE__?: boolean
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, eventId: number) => void }
  }
}

let token = ''
let callbackId = 0
// Scopes events and native listeners to this browser tab; the bridge expires tabs that stop polling.
const clientId = crypto.randomUUID()
const callbacks = new Map<number, { callback: (payload: unknown) => void; once: boolean }>()
const nativeStorageCommands = {
  snapshot: '__hiven_validation_storage_snapshot',
} as const

export function isNativeDesktopRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
    && !window.__HIVEN_WEB_NATIVE_BRIDGE__
}

function url(path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ token, ...params })
  return `${BRIDGE_BASE}/${path}?${query}`
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = crypto.randomUUID()
  const queued = await post('invoke', { id, clientId, command, args })
  if (!queued.ok) throw new Error(`Native validation bridge rejected ${command}`)

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const response = await fetch(url('result', { id }))
    if (response.status === 204) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      continue
    }
    const result = await response.json() as { ok: boolean; value?: T; error?: string }
    if (!result.ok) throw new Error(result.error || `Native command failed: ${command}`)
    return result.value as T
  }
  throw new Error(`Native validation bridge timed out: ${command}`)
}

function runCallback(id: number, payload: unknown): void {
  const entry = callbacks.get(id)
  if (!entry) return
  entry.callback(payload)
  if (entry.once) callbacks.delete(id)
}

async function pollEvents(): Promise<void> {
  while (window.__HIVEN_WEB_NATIVE_BRIDGE__) {
    try {
      const response = await fetch(url('events', { client: clientId }))
      const data = await response.json() as { events?: Array<{ callbackId: number; payload: unknown }> }
      for (const event of data.events ?? []) runCallback(event.callbackId, event.payload)
    } catch {
      // Desktop dev runtime may be restarting; the next poll reconnects.
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

async function shareDesktopLocalStorage(): Promise<void> {
  const snapshot = await Promise.race([
    invoke<Record<string, string>>(nativeStorageCommands.snapshot),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Desktop storage snapshot timed out')), 1_000)),
  ])
  for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value)
}

export async function installWebNativeBridge(): Promise<boolean> {
  if (!import.meta.env.DEV || (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return false
  try {
    const response = await fetch(`${BRIDGE_BASE}/session`, { signal: AbortSignal.timeout(300) })
    if (!response.ok) return false
    const session = await response.json() as { token?: string }
    if (!session.token) return false
    token = session.token
  } catch {
    return false
  }

  const label = new URLSearchParams(location.search).get('window') ?? 'launcher'
  const internals: BridgeInternals = {
    invoke,
    transformCallback(callback = () => undefined, once = false) {
      const id = ++callbackId
      callbacks.set(id, { callback, once })
      return id
    },
    unregisterCallback(id) {
      callbacks.delete(id)
    },
    runCallback,
    convertFileSrc: (path) => path,
    metadata: {
      currentWindow: { label },
      currentWebview: { label, windowLabel: label },
    },
    plugins: { path: { sep: '/', delimiter: ':' } },
  }
  ;(window as unknown as { __TAURI_INTERNALS__: BridgeInternals }).__TAURI_INTERNALS__ = internals
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined }
  window.__HIVEN_WEB_NATIVE_BRIDGE__ = true
  void pollEvents()
  try {
    await shareDesktopLocalStorage()
  } catch (error) {
    console.warn('[hiven] Desktop relay unavailable; using browser-only mode', error)
    window.__HIVEN_WEB_NATIVE_BRIDGE__ = false
    delete (window as unknown as { __TAURI_INTERNALS__?: BridgeInternals }).__TAURI_INTERNALS__
    return false
  }
  console.info('[hiven] Browser connected to desktop native validation bridge')
  return true
}

function mapChannels(
  value: unknown,
  Channel: new (handler: (payload: unknown) => void) => unknown,
  targetClientId: string,
): unknown {
  if (typeof value === 'string' && value.startsWith('__CHANNEL__:')) {
    const id = Number(value.slice('__CHANNEL__:'.length))
    return new Channel((payload) => void post('event', { clientId: targetClientId, callbackId: id, payload }))
  }
  if (Array.isArray(value)) return value.map((item) => mapChannels(item, Channel, targetClientId))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapChannels(item, Channel, targetClientId)]))
  }
  return value
}

export function startNativeValidationRelay(): () => void {
  if (!import.meta.env.DEV || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ || window.__HIVEN_WEB_NATIVE_BRIDGE__) {
    return () => undefined
  }
  let stopped = false
  const eventListeners = new Map<number, { clientId: string; unlisten: () => void }>()
  let remoteEventId = 0

  // A closed or reloaded tab never sends unlisten; drop its native listeners once the bridge expires it.
  const releaseDetachedListeners = (attachedClients: Set<string>) => {
    for (const [id, listener] of eventListeners) {
      if (attachedClients.has(listener.clientId)) continue
      listener.unlisten()
      eventListeners.delete(id)
    }
  }

  void (async () => {
    const [{ invoke: nativeInvoke, Channel }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ])
    while (!stopped) {
      let attached = false
      try {
        if (!token) {
          const session = await fetch(`${BRIDGE_BASE}/session`).then((response) => response.json()) as { token: string }
          token = session.token
        }
        const response = await fetch(url('requests'))
        if (!response.ok) throw new Error(`Native validation relay poll failed: ${response.status}`)
        const data = await response.json() as { requests?: RelayRequest[]; clients?: string[] }
        const attachedClients = new Set(data.clients ?? [])
        attached = attachedClients.size > 0
        releaseDetachedListeners(attachedClients)
        for (const request of data.requests ?? []) {
          try {
            if (['capture_desktop_snapshot', 'poll_keyboard_observation', 'stop_keyboard_observation'].includes(request.command)) {
              throw new Error('desktop-required')
            }
            let value: unknown
            if (request.command === nativeStorageCommands.snapshot) {
              value = Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
                const key = localStorage.key(index) ?? ''
                return [key, localStorage.getItem(key) ?? '']
              }).filter(([key]) => key))
            } else if (request.command === 'plugin:event|listen') {
              const callback = Number(request.args?.handler)
              const id = ++remoteEventId
              const unlisten = await listen(String(request.args?.event ?? ''), (event) => {
                void post('event', { clientId: request.clientId, callbackId: callback, payload: event })
              })
              eventListeners.set(id, { clientId: request.clientId, unlisten })
              value = id
            } else if (request.command === 'plugin:event|unlisten') {
              const id = Number(request.args?.eventId)
              eventListeners.get(id)?.unlisten()
              eventListeners.delete(id)
            } else {
              value = await nativeInvoke(request.command, mapChannels(request.args ?? {}, Channel, request.clientId) as Record<string, unknown>)
            }
            await post('result', { id: request.id, ok: true, value: value ?? null })
          } catch (error) {
            await post('result', {
              id: request.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      } catch {
        // Bridge starts with the native app and can briefly disappear during rebuilds; a restarted
        // bridge issues a new token, so re-read the session on the next poll.
        token = ''
      }
      await new Promise((resolve) => setTimeout(resolve, attached ? ACTIVE_RELAY_POLL_MS : IDLE_RELAY_POLL_MS))
    }
  })()

  return () => {
    stopped = true
    for (const listener of eventListeners.values()) listener.unlisten()
    eventListeners.clear()
  }
}
