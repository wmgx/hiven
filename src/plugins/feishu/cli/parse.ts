/**
 * Parse lark-cli --json stdout and strip search highlight tags.
 */

export type LarkCliParsed = {
  ok: boolean
  data?: unknown
  code?: string | number
  message?: string
  error?: unknown
  cliNotice?: unknown
  raw?: unknown
}

/**
 * Parse CLI JSON stdout. Supports top-level objects with optional `_notice`.
 * Returns a normalized envelope; never throws on empty/invalid input.
 */
export function parseLarkCliJson(stdout: string): LarkCliParsed {
  const text = (stdout ?? '').trim()
  if (!text) {
    return { ok: false, code: 'empty_output', message: 'CLI returned empty output' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Some CLIs may emit leading log lines; try last JSON object line
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    let parsed: unknown | undefined
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(lines[i]!)
        break
      } catch {
        // continue
      }
    }
    if (parsed === undefined) {
      return { ok: false, code: 'parse_error', message: 'Failed to parse CLI JSON output' }
    }
    raw = parsed
  }

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: true, data: raw, raw }
  }

  const obj = raw as Record<string, unknown>
  const cliNotice = obj._notice ?? obj.notice
  const ok = obj.ok !== false && obj.success !== false && obj.error == null
  const code =
    (typeof obj.code === 'string' || typeof obj.code === 'number' ? obj.code : undefined) ??
    (typeof obj.err_code === 'string' || typeof obj.err_code === 'number' ? obj.err_code : undefined) ??
    extractErrorField(obj.error, 'type') ??
    extractErrorField(obj.error, 'subtype')
  const message =
    typeof obj.message === 'string'
      ? obj.message
      : typeof obj.msg === 'string'
        ? obj.msg
        : typeof obj.error === 'string'
          ? obj.error
          : extractErrorField(obj.error, 'message')

  return {
    ok: Boolean(ok),
    data: 'data' in obj ? obj.data : obj,
    code,
    message,
    error: obj.error,
    cliNotice,
    raw,
  }
}

function extractErrorField(error: unknown, key: string): string | undefined {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Strip lark search highlight wrappers such as <h>…</h>, <em>…</em>.
 */
export function stripSearchHighlight(text: string): string {
  if (!text) return ''
  return text
    .replace(/<\/?h\b[^>]*>/gi, '')
    .replace(/<\/?em\b[^>]*>/gi, '')
    .replace(/<\/?mark\b[^>]*>/gi, '')
    .replace(/<\/?b\b[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
