export const MAX_LIST_BYTES = 1024 * 1024
export const MAX_LIST_LINES = 20000
export type ListCategory = 'leftOnly' | 'common' | 'rightOnly' | 'union'
export type ListComparison =
  | { ok: false; reason: 'bytes' | 'lines' | 'failed' }
  | { ok: true; values: Record<ListCategory, string[]>; ignored: { left: number; right: number }; duplicates: { left: number; right: number } }

export function compareLists(left: string, right: string): ListComparison {
  if (left.length + right.length > MAX_LIST_BYTES || new TextEncoder().encode(left).length + new TextEncoder().encode(right).length > MAX_LIST_BYTES) return { ok: false, reason: 'bytes' }
  const a = left ? left.split(/\r\n|\r|\n/) : []
  const b = right ? right.split(/\r\n|\r|\n/) : []
  if (a.length + b.length > MAX_LIST_LINES) return { ok: false, reason: 'lines' }
  function collect(lines: string[]) {
    const entries = new Map<string, string>()
    let ignored = 0, duplicates = 0
    for (const original of lines) {
      if (!original.trim()) { ignored++; continue }
      const key = original.trim()
      if (entries.has(key)) duplicates++
      else entries.set(key, key)
    }
    return { entries, ignored, duplicates }
  }
  const l = collect(a), r = collect(b)
  const values: Record<ListCategory, string[]> = { leftOnly: [], common: [], rightOnly: [], union: [...l.entries.keys(), ...[...r.entries.keys()].filter(key => !l.entries.has(key))] }
  for (const [key, original] of l.entries) values[r.entries.has(key) ? 'common' : 'leftOnly'].push(original)
  for (const [key, original] of r.entries) if (!l.entries.has(key)) values.rightOnly.push(original)
  return { ok: true, values, ignored: { left: l.ignored, right: r.ignored }, duplicates: { left: l.duplicates, right: r.duplicates } }
}
