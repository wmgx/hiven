import type { ActionResult } from '../store'

export function normalizeActionResult(result: ActionResult | void): ActionResult {
  if (!result) return {}
  return result
}

export function isSafeOpenUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol)
  } catch {
    return false
  }
}
