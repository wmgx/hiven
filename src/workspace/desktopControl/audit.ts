export type L2AuditEntry = {
  action: string
  targetSummary: string
  at?: number
}

const AUDIT_STORAGE_KEY = 'hiven:desktop-control:l2-audit'
const AUDIT_RING_MAX = 50

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readRing(): L2AuditEntry[] {
  const raw = storage()?.getItem(AUDIT_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is L2AuditEntry => {
      if (!entry || typeof entry !== 'object') return false
      const e = entry as L2AuditEntry
      return typeof e.action === 'string' && typeof e.targetSummary === 'string'
    })
  } catch {
    return []
  }
}

/**
 * Record an L2 confirmation action (close window / terminate process).
 * Never logs clipboard or free-form content bodies — only action + short target summary.
 */
export function auditL2Action(entry: L2AuditEntry): void {
  const at = typeof entry.at === 'number' ? entry.at : Date.now()
  const next: L2AuditEntry = {
    action: entry.action,
    targetSummary: entry.targetSummary,
    at,
  }
  try {
    console.info('[hiven:desktop-control:l2]', next.action, next.targetSummary)
  } catch {
    // ignore console failures
  }
  try {
    const ring = readRing()
    ring.push(next)
    while (ring.length > AUDIT_RING_MAX) ring.shift()
    storage()?.setItem(AUDIT_STORAGE_KEY, JSON.stringify(ring))
  } catch {
    // Best-effort ring buffer; never throw into execute path.
  }
}
