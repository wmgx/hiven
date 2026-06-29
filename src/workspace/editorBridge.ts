import type { EditorContextSnapshot } from '../launcher/context/contextBroker'
import type { SerializedRange } from './types'
import { showEditorWindow } from './windowManager/editorWindow'
import { EDITOR_WINDOW_LABEL } from './windowManager/windowLabels'

export const EDITOR_BRIDGE_REQUEST_EVENT = 'hiven://editor-bridge-request'
export const EDITOR_BRIDGE_RESPONSE_EVENT = 'hiven://editor-bridge-response'
export const EDITOR_BRIDGE_READY_EVENT = 'hiven://editor-bridge-ready'
export const EDITOR_ACTIVE_CONTEXT_EVENT = 'hiven://editor-active-context'
const EDITOR_BRIDGE_PENDING_REQUESTS_KEY = 'hiven:editor-bridge-pending-requests'
const EDITOR_ACTIVE_CONTEXT_SNAPSHOT_KEY = 'hiven:editor-active-context-snapshot'
const EDITOR_ACTIVE_PANE_SNAPSHOT_KEY = 'hiven:editor-active-pane-snapshot'
const EDITOR_BRIDGE_READY_AT_KEY = 'hiven:editor-bridge-ready-at'
const EDITOR_BRIDGE_READY_TTL_MS = 5_000
const EDITOR_BRIDGE_DEFAULT_TIMEOUT_MS = 1_200
const EDITOR_BRIDGE_CONTEXT_TIMEOUT_MS = 500
const EDITOR_BRIDGE_MUTATION_TIMEOUT_MS = 5_000

export type EditorBridgeCreatePaneInput = {
  text?: string
  title?: string
  language?: string
  focus?: boolean
  direction?: 'left' | 'right' | 'top' | 'bottom'
}

export type EditorBridgeTextInput = {
  text: string
  paneId?: string
  range?: SerializedRange
}

export type EditorBridgePanelInput = {
  panelId: string
  placement: 'right' | 'bottom' | 'left' | 'pane-bottom'
  paneId?: string
  inputs?: unknown
  title?: string
}

export type EditorBridgePluginCleanupInput = {
  pluginId: string
  panelIds: string[]
}

export type EditorPaneSnapshot = {
  activePaneId: string
  previousActivePaneId?: string
  paneIds: string[]
  panes: Record<string, {
    title?: string
    language?: string
    stickyScroll?: boolean
  }>
}

export type EditorBridgeRequest =
  | BridgeEnvelope<'getEditorContext', undefined>
  | BridgeEnvelope<'createEditorPane', EditorBridgeCreatePaneInput>
  | BridgeEnvelope<'replaceEditorSelection', EditorBridgeTextInput>
  | BridgeEnvelope<'insertIntoEditor', EditorBridgeTextInput>
  | BridgeEnvelope<'openEditorPanel', EditorBridgePanelInput>
  | BridgeEnvelope<'cleanupEditorPluginContributions', EditorBridgePluginCleanupInput>

export type EditorBridgeResponse = {
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

export type EditorBridgeHandlers = {
  getEditorContext(): EditorContextSnapshot | undefined
  createEditorPane(input: EditorBridgeCreatePaneInput): string | undefined
  replaceEditorSelection(input: EditorBridgeTextInput): void
  insertIntoEditor(input: EditorBridgeTextInput): void
  openEditorPanel(input: EditorBridgePanelInput): void
  cleanupEditorPluginContributions(input: EditorBridgePluginCleanupInput): void
}

type BridgeEnvelope<T extends string, P> = {
  requestId: string
  action: T
  payload: P
  createdAt: number
  expiresAt: number
}

type BridgeRequestOptions = {
  timeoutMs?: number
  persistForEditorStartup?: boolean
  openEditorFirst?: boolean
}

let activeEditorContextSnapshot: EditorContextSnapshot | undefined
let activeEditorPaneSnapshot: EditorPaneSnapshot | undefined
let activeContextListenerStarted = false
const activeEditorStateSubscribers = new Set<() => void>()

export async function getEditorContext(options: { timeoutMs?: number } = {}): Promise<EditorContextSnapshot | undefined> {
  try {
    const response = await sendEditorBridgeRequest('getEditorContext', undefined, { timeoutMs: options.timeoutMs ?? EDITOR_BRIDGE_CONTEXT_TIMEOUT_MS })
    return isEditorContextSnapshot(response) ? response : getActiveEditorContextSnapshot()
  } catch {
    return getActiveEditorContextSnapshot()
  }
}

export function getActiveEditorContextSnapshot(): EditorContextSnapshot | undefined {
  ensureActiveEditorContextListener()
  if (!activeEditorContextSnapshot) activeEditorContextSnapshot = readPersistedActiveEditorContextSnapshot()
  return activeEditorContextSnapshot
}

export function getActiveEditorPaneSnapshot(): EditorPaneSnapshot | undefined {
  ensureActiveEditorContextListener()
  if (!activeEditorPaneSnapshot) activeEditorPaneSnapshot = readPersistedActiveEditorPaneSnapshot()
  return activeEditorPaneSnapshot
}

export function subscribeActiveEditorState(subscriber: () => void): () => void {
  ensureActiveEditorContextListener()
  activeEditorStateSubscribers.add(subscriber)
  return () => {
    activeEditorStateSubscribers.delete(subscriber)
  }
}

export async function createEditorPane(input: EditorBridgeCreatePaneInput = {}): Promise<string | undefined> {
  const response = await sendEditorBridgeRequest('createEditorPane', input, {
    persistForEditorStartup: true,
    openEditorFirst: true,
  })
  return typeof response === 'string' ? response : undefined
}

export async function replaceEditorSelection(text: string, options: Omit<EditorBridgeTextInput, 'text'> = {}): Promise<void> {
  await sendEditorBridgeRequest('replaceEditorSelection', { ...options, text }, {
    persistForEditorStartup: true,
    openEditorFirst: true,
  })
}

export async function insertIntoEditor(text: string, options: Omit<EditorBridgeTextInput, 'text'> = {}): Promise<void> {
  await sendEditorBridgeRequest('insertIntoEditor', { ...options, text }, {
    persistForEditorStartup: true,
    openEditorFirst: true,
  })
}

export async function openEditorPanel(input: EditorBridgePanelInput): Promise<void> {
  await sendEditorBridgeRequest('openEditorPanel', input, {
    persistForEditorStartup: true,
    openEditorFirst: true,
  })
}

export async function cleanupEditorPluginContributions(input: EditorBridgePluginCleanupInput): Promise<void> {
  await sendEditorBridgeRequest('cleanupEditorPluginContributions', input)
}

export function registerActiveEditorContext(snapshot: EditorContextSnapshot): void {
  activeEditorContextSnapshot = snapshot
  persistActiveEditorContextSnapshot(snapshot)
  notifyActiveEditorStateSubscribers()
  emitActiveEditorState({ editor: snapshot })
}

export function updateActivePaneSnapshot(snapshot: EditorPaneSnapshot): void {
  activeEditorPaneSnapshot = snapshot
  persistActiveEditorPaneSnapshot(snapshot)
  notifyActiveEditorStateSubscribers()
  emitActiveEditorState({ pane: snapshot })
}

export function clearActiveEditorSnapshots(): void {
  activeEditorContextSnapshot = undefined
  activeEditorPaneSnapshot = undefined
  removePersistedActiveEditorSnapshots()
  notifyActiveEditorStateSubscribers()
  emitActiveEditorState({ editor: null, pane: null })
}

export async function registerEditorBridgeHandlers(handlers: EditorBridgeHandlers): Promise<() => void> {
  consumePendingEditorBridgeRequests((request) => handleEditorBridgeRequest(request, handlers))

  if (!isTauriRuntime()) return () => undefined

  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<unknown>(EDITOR_BRIDGE_REQUEST_EVENT, (event) => {
    if (!isEditorBridgeRequest(event.payload)) return
    void handleEditorBridgeRequest(event.payload, handlers)
  })
  await emitEditorBridgeReady()
  return unlisten
}

async function sendEditorBridgeRequest<T extends EditorBridgeRequest['action']>(
  action: T,
  payload: Extract<EditorBridgeRequest, { action: T }>['payload'],
  options: BridgeRequestOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? getEditorBridgeActionTimeoutMs(action)
  let request: Extract<EditorBridgeRequest, { action: T }> | undefined
  let persisted = false
  try {
    if (options.openEditorFirst) await showEditorWindow()
    if (options.openEditorFirst && isTauriRuntime()) await waitForEditorBridgeReady(timeoutMs)
    request = createEditorBridgeRequest(action, payload, timeoutMs)
    if (options.persistForEditorStartup) {
      persistPendingEditorBridgeRequest(request)
      persisted = true
    }

    if (!isTauriRuntime()) return undefined

    const { emitTo, listen } = await import('@tauri-apps/api/event')
    const responsePromise = await waitForEditorBridgeResponse(listen, request.requestId, timeoutMs)
    await emitTo(EDITOR_WINDOW_LABEL, EDITOR_BRIDGE_REQUEST_EVENT, request)
    const response = await responsePromise
    if (!response.ok) throw new Error(response.error ?? `Editor bridge request failed: ${request.action}`)
    return response.value
  } catch (error) {
    if (persisted && request) clearPendingEditorBridgeRequest(request.requestId)
    throw error
  }
}

async function waitForEditorBridgeReady(timeoutMs: number): Promise<void> {
  if (hasRecentEditorBridgeReady()) return
  const { listen } = await import('@tauri-apps/api/event')
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let unlistenReady: (() => void) | undefined
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      unlistenReady?.()
      reject(new Error('Timed out waiting for editor bridge ready'))
    }, timeoutMs)
    listen<unknown>(EDITOR_BRIDGE_READY_EVENT, () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      unlistenReady?.()
      resolve()
    })
      .then((unlisten) => {
        unlistenReady = unlisten
        if (settled) unlisten()
      })
      .catch((error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

function createEditorBridgeRequest<T extends EditorBridgeRequest['action']>(
  action: T,
  payload: Extract<EditorBridgeRequest, { action: T }>['payload'],
  timeoutMs: number,
): Extract<EditorBridgeRequest, { action: T }> {
  const createdAt = Date.now()
  return {
    requestId: `editor-bridge-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    payload,
    createdAt,
    expiresAt: createdAt + Math.max(timeoutMs, 0),
  } as Extract<EditorBridgeRequest, { action: T }>
}

async function handleEditorBridgeRequest(request: EditorBridgeRequest, handlers: EditorBridgeHandlers): Promise<void> {
  clearPendingEditorBridgeRequest(request.requestId)
  try {
    if (isEditorBridgeRequestExpired(request)) {
      throw new Error(`Editor bridge request expired before execution: ${request.action}`)
    }
    let value: unknown
    switch (request.action) {
      case 'getEditorContext':
        value = handlers.getEditorContext()
        break
      case 'createEditorPane':
        value = handlers.createEditorPane(request.payload)
        break
      case 'replaceEditorSelection':
        handlers.replaceEditorSelection(request.payload)
        break
      case 'insertIntoEditor':
        handlers.insertIntoEditor(request.payload)
        break
      case 'openEditorPanel':
        handlers.openEditorPanel(request.payload)
        break
      case 'cleanupEditorPluginContributions':
        handlers.cleanupEditorPluginContributions(request.payload)
        break
    }
    await emitEditorBridgeResponse({ requestId: request.requestId, ok: true, value })
  } catch (error) {
    await emitEditorBridgeResponse({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function waitForEditorBridgeResponse(
  listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>,
  requestId: string,
  timeoutMs: number,
): Promise<EditorBridgeResponse> {
  let resolveResponse: (response: EditorBridgeResponse) => void = () => undefined
  let rejectResponse: (error: Error) => void = () => undefined
  const responsePromise = new Promise<EditorBridgeResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  const unlisten = await listen<unknown>(EDITOR_BRIDGE_RESPONSE_EVENT, (event) => {
    if (!isEditorBridgeResponse(event.payload) || event.payload.requestId !== requestId) return
    window.clearTimeout(timer)
    unlisten()
    resolveResponse(event.payload)
  })
  const timer = window.setTimeout(() => {
    unlisten()
    rejectResponse(new Error(`Timed out waiting for editor bridge response: ${requestId}`))
  }, timeoutMs)
  return responsePromise
}

async function emitEditorBridgeResponse(response: EditorBridgeResponse): Promise<void> {
  if (!isTauriRuntime()) return
  const { emit } = await import('@tauri-apps/api/event')
  await emit(EDITOR_BRIDGE_RESPONSE_EVENT, response)
}

async function emitEditorBridgeReady(): Promise<void> {
  const readyAt = Date.now()
  try {
    localStorage.setItem(EDITOR_BRIDGE_READY_AT_KEY, String(readyAt))
  } catch {
    // The live event is enough for already-running windows.
  }
  if (!isTauriRuntime()) return
  const { emit } = await import('@tauri-apps/api/event')
  await emit(EDITOR_BRIDGE_READY_EVENT, { windowLabel: EDITOR_WINDOW_LABEL, readyAt })
}

function hasRecentEditorBridgeReady(): boolean {
  try {
    const readyAt = Number(localStorage.getItem(EDITOR_BRIDGE_READY_AT_KEY) ?? 0)
    return Number.isFinite(readyAt) && Date.now() - readyAt < EDITOR_BRIDGE_READY_TTL_MS
  } catch {
    return false
  }
}

function emitActiveEditorState(payload: { editor?: EditorContextSnapshot | null; pane?: EditorPaneSnapshot | null }): void {
  if (!isTauriRuntime()) return
  import('@tauri-apps/api/event')
    .then(({ emit }) => emit(EDITOR_ACTIVE_CONTEXT_EVENT, payload))
    .catch(() => undefined)
}

function ensureActiveEditorContextListener(): void {
  if (activeContextListenerStarted || !isTauriRuntime()) return
  activeContextListenerStarted = true
  import('@tauri-apps/api/event')
    .then(({ listen }) => listen<unknown>(EDITOR_ACTIVE_CONTEXT_EVENT, (event) => {
      const payload = event.payload as { editor?: unknown; pane?: unknown }
      let changed = false
      if (payload.editor === null) {
        activeEditorContextSnapshot = undefined
        removePersistedActiveEditorContextSnapshot()
        changed = true
      } else if (isEditorContextSnapshot(payload.editor)) {
        activeEditorContextSnapshot = payload.editor
        persistActiveEditorContextSnapshot(payload.editor)
        changed = true
      }
      if (payload.pane === null) {
        activeEditorPaneSnapshot = undefined
        removePersistedActiveEditorPaneSnapshot()
        changed = true
      } else if (isEditorPaneSnapshot(payload.pane)) {
        activeEditorPaneSnapshot = payload.pane
        persistActiveEditorPaneSnapshot(payload.pane)
        changed = true
      }
      if (changed) notifyActiveEditorStateSubscribers()
    }))
    .catch(() => {
      activeContextListenerStarted = false
    })
}

function notifyActiveEditorStateSubscribers(): void {
  for (const subscriber of activeEditorStateSubscribers) {
    try {
      subscriber()
    } catch {
      // Keep one broken subscriber from blocking other mirrored editor state consumers.
    }
  }
}

function persistActiveEditorContextSnapshot(snapshot: EditorContextSnapshot): void {
  try {
    localStorage.setItem(EDITOR_ACTIVE_CONTEXT_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Live events are enough for already-running windows.
  }
}

function persistActiveEditorPaneSnapshot(snapshot: EditorPaneSnapshot): void {
  try {
    localStorage.setItem(EDITOR_ACTIVE_PANE_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Live events are enough for already-running windows.
  }
}

function readPersistedActiveEditorContextSnapshot(): EditorContextSnapshot | undefined {
  try {
    const raw = localStorage.getItem(EDITOR_ACTIVE_CONTEXT_SNAPSHOT_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return isEditorContextSnapshot(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function readPersistedActiveEditorPaneSnapshot(): EditorPaneSnapshot | undefined {
  try {
    const raw = localStorage.getItem(EDITOR_ACTIVE_PANE_SNAPSHOT_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return isEditorPaneSnapshot(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function removePersistedActiveEditorSnapshots(): void {
  removePersistedActiveEditorContextSnapshot()
  removePersistedActiveEditorPaneSnapshot()
}

function removePersistedActiveEditorContextSnapshot(): void {
  try {
    localStorage.removeItem(EDITOR_ACTIVE_CONTEXT_SNAPSHOT_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

function removePersistedActiveEditorPaneSnapshot(): void {
  try {
    localStorage.removeItem(EDITOR_ACTIVE_PANE_SNAPSHOT_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

function persistPendingEditorBridgeRequest(request: EditorBridgeRequest): void {
  try {
    const pending = readPendingEditorBridgeRequests()
      .filter((candidate) => !isEditorBridgeRequestExpired(candidate))
    pending.push(request)
    localStorage.setItem(EDITOR_BRIDGE_PENDING_REQUESTS_KEY, JSON.stringify(pending))
  } catch {
    // Live events still handle already-loaded editor windows.
  }
}

function consumePendingEditorBridgeRequests(handle: (request: EditorBridgeRequest) => void): void {
  const pending = readPendingEditorBridgeRequests()
  localStorage.removeItem(EDITOR_BRIDGE_PENDING_REQUESTS_KEY)
  for (const request of pending) handle(request)
}

function clearPendingEditorBridgeRequest(requestId: string): void {
  const pending = readPendingEditorBridgeRequests().filter((request) => request.requestId !== requestId)
  if (pending.length === 0) {
    localStorage.removeItem(EDITOR_BRIDGE_PENDING_REQUESTS_KEY)
    return
  }
  localStorage.setItem(EDITOR_BRIDGE_PENDING_REQUESTS_KEY, JSON.stringify(pending))
}

function readPendingEditorBridgeRequests(): EditorBridgeRequest[] {
  try {
    const raw = localStorage.getItem(EDITOR_BRIDGE_PENDING_REQUESTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEditorBridgeRequest).filter((request) => !isEditorBridgeRequestExpired(request)) : []
  } catch {
    return []
  }
}

function isEditorBridgeRequest(value: unknown): value is EditorBridgeRequest {
  const request = value as Partial<EditorBridgeRequest> | undefined
  if (!request || typeof request !== 'object') return false
  if (typeof request.requestId !== 'string' || typeof request.createdAt !== 'number' || typeof request.expiresAt !== 'number') return false
  return request.action === 'getEditorContext' ||
    request.action === 'createEditorPane' ||
    request.action === 'replaceEditorSelection' ||
    request.action === 'insertIntoEditor' ||
    request.action === 'openEditorPanel' ||
    request.action === 'cleanupEditorPluginContributions'
}

function isEditorBridgeRequestExpired(request: EditorBridgeRequest): boolean {
  return Date.now() > request.expiresAt
}

function getEditorBridgeActionTimeoutMs(action: EditorBridgeRequest['action']): number {
  if (action === 'getEditorContext') return EDITOR_BRIDGE_CONTEXT_TIMEOUT_MS
  if (action === 'createEditorPane' || action === 'replaceEditorSelection' || action === 'insertIntoEditor' || action === 'openEditorPanel' || action === 'cleanupEditorPluginContributions') {
    return EDITOR_BRIDGE_MUTATION_TIMEOUT_MS
  }
  return EDITOR_BRIDGE_DEFAULT_TIMEOUT_MS
}

function isEditorBridgeResponse(value: unknown): value is EditorBridgeResponse {
  const response = value as Partial<EditorBridgeResponse> | undefined
  return Boolean(response && typeof response === 'object' && typeof response.requestId === 'string' && typeof response.ok === 'boolean')
}

function isEditorContextSnapshot(value: unknown): value is EditorContextSnapshot {
  const snapshot = value as Partial<EditorContextSnapshot> | undefined
  return Boolean(snapshot && typeof snapshot === 'object' && snapshot.windowLabel === 'editor' && typeof snapshot.activePaneId === 'string' && Array.isArray(snapshot.paneIds) && typeof snapshot.activeText === 'string')
}

function isEditorPaneSnapshot(value: unknown): value is EditorPaneSnapshot {
  const snapshot = value as Partial<EditorPaneSnapshot> | undefined
  return Boolean(snapshot && typeof snapshot === 'object' && typeof snapshot.activePaneId === 'string' && Array.isArray(snapshot.paneIds))
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
