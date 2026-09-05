import type { DesktopBridgeEventDto } from './desktopControl/bridgeTargets'

type BrowserEventPayload = Omit<DesktopBridgeEventDto, 'sourceId' | 'type'>

export type HivenEvent<TType extends string, TPayload> = {
  type: TType
  publisher: { kind: 'host'; id: 'browser-bridge' }
  source: { kind: 'plugin'; id: 'web-open'; channel: string }
  payload: TPayload
}

export type HivenHostEvents = {
  'browser.opened': HivenEvent<'browser.opened', BrowserEventPayload>
  'browser.activated': HivenEvent<'browser.activated', BrowserEventPayload>
}

export type HivenEventBusApi = {
  subscribe: <K extends keyof HivenHostEvents>(
    type: K,
    listener: (event: HivenHostEvents[K]) => void,
  ) => Promise<() => void>
}

type NativeBrowserBridgeBatch = { sourceId?: string; events?: DesktopBridgeEventDto[] }

const listeners = new Map<keyof HivenHostEvents, Set<(event: never) => void>>()
let nativeListener: Promise<void> | null = null

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  )
}

function publishBrowserEvent(
  type: keyof HivenHostEvents,
  sourceId: string,
  payload: BrowserEventPayload,
): void {
  const event = {
    type,
    publisher: { kind: 'host', id: 'browser-bridge' },
    source: { kind: 'plugin', id: 'web-open', channel: sourceId },
    payload,
  } as HivenHostEvents[typeof type]
  for (const listener of listeners.get(type) ?? []) listener(event as never)
}

function ensureNativeListener(): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve()
  nativeListener ??= import('@tauri-apps/api/event').then(async ({ listen }) => {
    await listen<NativeBrowserBridgeBatch>('hiven://browser-bridge-events', ({ payload }) => {
      if (!payload?.sourceId || !Array.isArray(payload.events)) return
      for (const { type, sourceId: _sourceId, ...event } of payload.events) {
        if (type === 'tab.opened') publishBrowserEvent('browser.opened', payload.sourceId, event)
        if (type === 'tab.activated') publishBrowserEvent('browser.activated', payload.sourceId, event)
      }
    })
  })
  return nativeListener
}

export const hivenEventBus: HivenEventBusApi = {
  async subscribe(type, listener) {
    const bucket = listeners.get(type) ?? new Set()
    bucket.add(listener as (event: never) => void)
    listeners.set(type, bucket)
    await ensureNativeListener()
    return () => bucket.delete(listener as (event: never) => void)
  },
}
