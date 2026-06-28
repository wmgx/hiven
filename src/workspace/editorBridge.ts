import type { EditorContextSnapshot } from '../launcher/context/contextBroker'
import type { SerializedRange } from './types'
import { showEditorWindow } from './windowManager/editorWindow'
import { EDITOR_WINDOW_LABEL } from './windowManager/windowLabels'

export const EDITOR_BRIDGE_REQUEST_EVENT = 'hiven://editor-bridge-request'
export const EDITOR_BRIDGE_RESPONSE_EVENT = 'hiven://editor-bridge-response'
export const EDITOR_ACTIVE_CONTEXT_EVENT = 'hiven://editor-active-context'
const EDITOR_BRIDGE_PENDING_REQUESTS_KEY = 'hiven:editor-bridge-pending-requests'

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
  inputs?: unknown
  title?: string
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
}

type BridgeEnvelope<T extends string, P> = {
  requestId: string
  action: T
  payload: P
  createdAt: number
}

type BridgeRequestOptions = {
  timeoutMs?: number
  persistForEditorStartup?: boolean
  openEditorFirst?: boolean
}

let activeEditorContextSnapshot: EditorContextSnapshot | undefined
let activeEditorPaneSnapshot: EditorPaneSnapshot | undefined
let activeContextListenerStarted = false

export async function getEditorContext(options: { timeoutMs?: number } = {}): Promise<EditorContextSnapshot | undefined> {
  try {
    const response = await sendEditorBridgeRequest('getEditorContext', undefined, { timeoutMs: options.timeoutMs ?? 500 })
    return isEditorContextSnapshot(response) ? response : activeEditorContextSnapshot
  } catch {
    return activeEditorContextSnapshot
  }
}

export function getActiveEditorContextSnapshot(): EditorContextSnapshot | undefined {
  ensureActiveEditorContextListener()
  return activeEditorContextSnapshot
}

export function getActiveEditorPaneSnapshot(): EditorPaneSnapshot | undefined {
  ensureActiveEditorContextListener()
  return activeEditorPaneSnapshot
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

export function registerActiveEditorContext(snapshot: EditorContextSnapshot): void {
  activeEditorContextSnapshot = snapshot
  emitActiveEditorState({ editor: snapshot })
}

export function updateActivePaneSnapshot(snapshot: EditorPaneSnapshot): void {
  activeEditorPaneSnapshot = snapshot
  emitActiveEditorState({ pane: snapshot })
}

export async function registerEditorBridgeHandlers(handlers: EditorBridgeHandlers): Promise<() => void> {
  consumePendingEditorBridgeRequests((request) => handleEditorBridgeRequest(request, handlers))

  if (!isTauriRuntime()) return () => undefined

  const { listen } = await import('@tauri-apps/api/event')
  return listen<unknown>(EDITOR_BRIDGE_REQUEST_EVENT, (event) => {
    if (!isEditorBridgeRequest(event.payload)) return
    void handleEditorBridgeRequest(event.payload, handlers)
  })
}

async function sendEditorBridgeRequest<T extends EditorBridgeRequest['action']>(
  action: T,
  payload: Extract<EditorBridgeRequest, { action: T }>['payload'],
  options: BridgeRequestOptions = {},
): Promise<unknown> {
  const request = createEditorBridgeRequest(action, payload)
  if (options.persistForEditorStartup) persistPendingEditorBridgeRequest(request)
  if (options.openEditorFirst) await showEditorWindow()

  if (!isTauriRuntime()) return undefined

  const { emitTo, listen } = await import('@tauri-apps/api/event')
  const responsePromise = await waitForEditorBridgeResponse(listen, request.requestId, options.timeoutMs ?? 1200)
  await emitTo(EDITOR_WINDOW_LABEL, EDITOR_BRIDGE_REQUEST_EVENT, request)
  const response = await responsePromise
  if (!response.ok) throw new Error(response.error ?? `Editor bridge request failed: ${request.action}`)
  return response.value
}

function createEditorBridgeRequest<T extends EditorBridgeRequest['action']>(
  action: T,
  payload: Extract<EditorBridgeRequest, { action: T }>['payload'],
): Extract<EditorBridgeRequest, { action: T }> {
  return {
    requestId: `editor-bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    payload,
    createdAt: Date.now(),
  } as Extract<EditorBridgeRequest, { action: T }>
}

async function handleEditorBridgeRequest(request: EditorBridgeRequest, handlers: EditorBridgeHandlers): Promise<void> {
  clearPendingEditorBridgeRequest(request.requestId)
  try {
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

function emitActiveEditorState(payload: { editor?: EditorContextSnapshot; pane?: EditorPaneSnapshot }): void {
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
      if (isEditorContextSnapshot(payload.editor)) activeEditorContextSnapshot = payload.editor
      if (isEditorPaneSnapshot(payload.pane)) activeEditorPaneSnapshot = payload.pane
    }))
    .catch(() => {
      activeContextListenerStarted = false
    })
}

function persistPendingEditorBridgeRequest(request: EditorBridgeRequest): void {
  try {
    const pending = readPendingEditorBridgeRequests()
      .filter((candidate) => Date.now() - candidate.createdAt < 30_000)
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
    return Array.isArray(parsed) ? parsed.filter(isEditorBridgeRequest) : []
  } catch {
    return []
  }
}

function isEditorBridgeRequest(value: unknown): value is EditorBridgeRequest {
  const request = value as Partial<EditorBridgeRequest> | undefined
  if (!request || typeof request !== 'object') return false
  if (typeof request.requestId !== 'string' || typeof request.createdAt !== 'number') return false
  return request.action === 'getEditorContext' ||
    request.action === 'createEditorPane' ||
    request.action === 'replaceEditorSelection' ||
    request.action === 'insertIntoEditor' ||
    request.action === 'openEditorPanel'
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
