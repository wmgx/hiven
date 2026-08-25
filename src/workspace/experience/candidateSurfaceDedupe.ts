const surfaced = new Set<string>()

export function shouldRecordCandidateSurface(sessionId: string, candidateKey: string): boolean {
  const dedupeKey = `${sessionId}:${candidateKey}`
  if (surfaced.has(dedupeKey)) return false
  surfaced.add(dedupeKey)
  return true
}
