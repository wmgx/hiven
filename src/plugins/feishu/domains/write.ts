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
  /** Optional; derived from content or defaulted by caller when empty. */
  title?: string
  content?: string
  confirmed: boolean
  signal?: AbortSignal
}): Promise<{ ok: boolean; message?: string; code?: string | number; hint?: string; data?: unknown; url?: string }> {
  const content = options.content?.trim() ?? ''
  const title = (options.title?.trim() || deriveTitleFromContent(content) || 'Untitled').slice(0, 120)

  const args = ['docs', '+create', '--as', 'user', '--title', title]
  if (content) {
    args.push('--doc-format', 'markdown', '--content', content)
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

export type FeishuSheetKind = 'sheet' | 'bitable'

/**
 * Create a spreadsheet (`sheets +create`) or multi-dimensional table (`base +base-create`).
 */
export async function createSheet(options: {
  shell: LarkCliShell
  binaryPath?: string
  kind: FeishuSheetKind
  title?: string
  confirmed: boolean
  signal?: AbortSignal
}): Promise<{ ok: boolean; message?: string; code?: string | number; hint?: string; data?: unknown; url?: string }> {
  const kind = options.kind === 'bitable' ? 'bitable' : 'sheet'
  const title = (options.title?.trim() || (kind === 'bitable' ? 'Untitled base' : 'Untitled sheet')).slice(0, 120)

  const args =
    kind === 'bitable'
      ? ['base', '+base-create', '--as', 'user', '--name', title]
      : ['sheets', '+create', '--as', 'user', '--title', title]

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

/** First non-empty markdown line as title (strip leading #). */
export function deriveTitleFromContent(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim().replace(/^#{1,6}\s+/, '').trim()
    if (t) return t.slice(0, 80)
  }
  return undefined
}

function extractUrl(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const obj = data as Record<string, unknown>
  for (const key of ['url', 'doc_url', 'document_url', 'share_url', 'spreadsheet_url', 'link']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key] as string
  }
  // Common nested shapes from sheets/base create
  for (const nest of ['document', 'spreadsheet', 'base', 'app', 'data']) {
    const child = obj[nest]
    if (child && typeof child === 'object') {
      const found = extractUrl(child)
      if (found) return found
    }
  }
  return undefined
}
