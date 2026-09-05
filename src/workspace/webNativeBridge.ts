const BRIDGE_BASE = 'http://127.0.0.1:19246/v1/validation'

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

declare global {
  interface Window {
    __HIVEN_WEB_NATIVE_BRIDGE__?: boolean
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, eventId: number) => void }
  }
}

let token = ''
let callbackId = 0
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
  const queued = await post('invoke', { id, command, args })
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
      const response = await fetch(url('events'))
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

function mapChannels(value: unknown, Channel: new (handler: (payload: unknown) => void) => unknown): unknown {
  if (typeof value === 'string' && value.startsWith('__CHANNEL__:')) {
    const id = Number(value.slice('__CHANNEL__:'.length))
    return new Channel((payload) => void post('event', { callbackId: id, payload }))
  }
  if (Array.isArray(value)) return value.map((item) => mapChannels(item, Channel))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapChannels(item, Channel)]))
  }
  return value
}

export function startNativeValidationRelay(): () => void {
  if (!import.meta.env.DEV || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ || window.__HIVEN_WEB_NATIVE_BRIDGE__) {
    return () => undefined
  }
  let stopped = false
  const eventUnlisteners = new Map<number, () => void>()
  let remoteEventId = 0

  void (async () => {
    const [{ invoke: nativeInvoke, Channel }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ])
    while (!stopped) {
      try {
        const session = await fetch(`${BRIDGE_BASE}/session`).then((response) => response.json()) as { token: string }
        token = session.token
        const data = await fetch(url('requests')).then((response) => response.json()) as {
          requests?: Array<{ id: string; command: string; args?: Record<string, unknown> }>
        }
        for (const request of data.requests ?? []) {
          try {
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
                void post('event', { callbackId: callback, payload: event })
              })
              eventUnlisteners.set(id, unlisten)
              value = id
            } else if (request.command === 'plugin:event|unlisten') {
              const id = Number(request.args?.eventId)
              eventUnlisteners.get(id)?.()
              eventUnlisteners.delete(id)
            } else {
              value = await nativeInvoke(request.command, mapChannels(request.args ?? {}, Channel) as Record<string, unknown>)
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
        // Bridge starts with the native app and can briefly disappear during rebuilds.
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })()

  return () => {
    stopped = true
    for (const unlisten of eventUnlisteners.values()) unlisten()
    eventUnlisteners.clear()
  }
}
