/**
 * Pure snippet expansion helpers (no host I/O).
 */

export type SnippetExpandContext = {
  clipboard?: string
  selection?: string
  query?: string
  now?: Date
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${formatTime(d)}`
}

/**
 * Expand `{clipboard}`, `{selection}`, `{query}`, `{date}`, `{time}`, `{datetime}`.
 * Unknown tokens are left unchanged.
 */
export function expandSnippetTemplate(body: string, ctx: SnippetExpandContext = {}): string {
  const now = ctx.now ?? new Date()
  const map: Record<string, string> = {
    clipboard: ctx.clipboard ?? '',
    selection: ctx.selection ?? '',
    query: ctx.query ?? '',
    date: formatDate(now),
    time: formatTime(now),
    datetime: formatDateTime(now),
  }
  return body.replace(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g, (full, key: string) => {
    const k = key.toLowerCase()
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k]! : full
  })
}
