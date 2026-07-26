/**
 * Feishu controlled writes (B4): message send / event create / doc create.
 * Callers must pass confirmed:true only after L2 launcher confirmation.
 */

import { runLarkCli, type LarkCliShell } from '../cli/run'

export async function sendMessage(options: {
  shell: LarkCliShell
  binaryPath?: string
  chatId?: string
  userId?: string
  text: string
  confirmed: boolean
  signal?: AbortSignal
}): Promise<{ ok: boolean; message?: string; code?: string | number; hint?: string; data?: unknown }> {
  const text = options.text.trim()
  if (!text) {
    return { ok: false, code: 'invalid_input', message: 'Message text is required' }
  }
  if (!options.chatId && !options.userId) {
    return { ok: false, code: 'invalid_input', message: 'chatId or userId is required' }
  }

  const args = ['im', '+messages-send', '--as', 'user', '--text', text]
  if (options.chatId) args.push('--chat-id', options.chatId)
  if (options.userId) args.push('--user-id', options.userId)

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: 15000,
    signal: options.signal,
    risk: 'write',
    confirmed: options.confirmed,
  })

  return {
    ok: result.ok,
    message: result.message,
    code: result.code,
    hint: result.hint,
    data: result.data,
  }
}

export async function createCalendarEvent(options: {
  shell: LarkCliShell
  binaryPath?: string
  summary: string
  start: string
  end: string
  description?: string
  confirmed: boolean
  signal?: AbortSignal
}): Promise<{ ok: boolean; message?: string; code?: string | number; hint?: string; data?: unknown }> {
  const summary = options.summary.trim()
  if (!summary || !options.start.trim() || !options.end.trim()) {
    return { ok: false, code: 'invalid_input', message: 'summary, start, and end are required' }
  }

  const args = [
    'calendar',
    '+create',
    '--as',
    'user',
    '--summary',
    summary,
    '--start',
    options.start.trim(),
    '--end',
    options.end.trim(),
  ]
  if (options.description?.trim()) {
    args.push('--description', options.description.trim())
  }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: 15000,
    signal: options.signal,
    risk: 'write',
    confirmed: options.confirmed,
  })

  return {
    ok: result.ok,
    message: result.message,
    code: result.code,
    hint: result.hint,
    data: result.data,
  }
}

export async function createDoc(options: {
  shell: LarkCliShell
  binaryPath?: string
  title: string
  content?: string
  confirmed: boolean
  signal?: AbortSignal
}): Promise<{ ok: boolean; message?: string; code?: string | number; hint?: string; data?: unknown; url?: string }> {
  const title = options.title.trim()
  if (!title) {
    return { ok: false, code: 'invalid_input', message: 'title is required' }
  }

  const args = ['docs', '+create', '--as', 'user', '--title', title]
  if (options.content?.trim()) {
    args.push('--doc-format', 'markdown', '--content', options.content.trim())
  }

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: 20000,
    signal: options.signal,
    risk: 'write',
    confirmed: options.confirmed,
  })

  const url = extractUrl(result.data)
  return {
    ok: result.ok,
    message: result.message,
    code: result.code,
    hint: result.hint,
    data: result.data,
    url,
  }
}

function extractUrl(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  for (const key of ['url', 'doc_url', 'document_url', 'share_url']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key] as string
  }
  if (obj.document && typeof obj.document === 'object') {
    return extractUrl(obj.document)
  }
  if (obj.data && typeof obj.data === 'object') {
    return extractUrl(obj.data)
  }
  return undefined
}
