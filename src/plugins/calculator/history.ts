export type HistoryEntry = {
  expression: string
  result: string
}

export function readHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is HistoryEntry => (
    item !== null && typeof item === 'object'
    && typeof item.expression === 'string' && typeof item.result === 'string'
  )).map(({ expression, result }) => ({ expression, result }))
}

export function rememberCalculation(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history.filter((item) => item.expression !== entry.expression || item.result !== entry.result)]
}
