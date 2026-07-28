/**
 * Pure decision layer for Feishu deep-link delivery.
 *
 * Split out of windowFocus.ts so the "which command, and when to stop"
 * decisions are testable without spawning shells.
 *
 * IMPORTANT: this file must stay free of relative imports — the contract test
 * (scripts/test-feishu-cli-logic.mjs) skips transpiling any file that has them.
 */

/** Result shape we care about from a shell command run. */
export type DeliveryOutcome = {
  exitCode?: number | null
  timedOut?: boolean
}

/** One delivery attempt: a shell command plus why we chose it. */
export type DeliveryCandidate = {
  command: string
  /** Diagnostic label surfaced in [feishu:open] logs. */
  reason: 'resolved-app' | 'launch-services' | 'bundle-id'
}

export type DeliveryOptions = {
  /** Absolute path to the installed Feishu/Lark .app, when resolvable. */
  appPath?: string
  /** Bundle identifier fallback. */
  bundleId?: string
}

const DEFAULT_BUNDLE_ID = 'com.electron.lark'

/** True if URL uses a Feishu/Lark native client scheme. */
export function isClientScheme(url: string): boolean {
  return /^(lark|feishu|x-feishu|x-lark):\/\//i.test(url.trim())
}

/** POSIX-safe single-quoting for shell arguments. */
export function shellQuote(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:=+@%,-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Build the ordered delivery attempts for a client-scheme URL.
 *
 * Order matters: the most specific target goes first so the deep link is
 * handed to the exact installed client instead of whatever LaunchServices
 * happens to have registered (a BOE / staging build can otherwise swallow it).
 *
 * Non-client URLs return [] — https is the host openUrl's job.
 */
export function buildDeliveryCandidates(
  url: string,
  options: DeliveryOptions,
): DeliveryCandidate[] {
  const target = url.trim()
  if (!target || !isClientScheme(target)) return []

  const candidates: DeliveryCandidate[] = []
  const quotedUrl = shellQuote(target)

  const appPath = options.appPath?.trim()
  if (appPath) {
    candidates.push({
      command: `open -a ${shellQuote(appPath)} ${quotedUrl}`,
      reason: 'resolved-app',
    })
  }

  candidates.push({
    command: `open ${quotedUrl}`,
    reason: 'launch-services',
  })

  candidates.push({
    command: `open -b ${shellQuote(options.bundleId?.trim() || DEFAULT_BUNDLE_ID)} ${quotedUrl}`,
    reason: 'bundle-id',
  })

  return candidates
}

/**
 * Whether delivery succeeded and the loop must stop.
 *
 * Deliberately stops on the FIRST accepted attempt. Delivering the same deep
 * link twice makes the client re-handle the URL, which can reset an
 * already-navigated window back to its default page — the root cause of the
 * intermittent "opened but did not jump" behaviour.
 *
 * Note: exit 0 only proves LaunchServices accepted the URL, not that the
 * client finished routing. It is the strongest signal available without
 * polling window titles, and polling would add latency to the critical path.
 */
export function shouldStopAfterDelivery(outcome: DeliveryOutcome): boolean {
  if (outcome.timedOut) return false
  const code = outcome.exitCode
  return code === 0 || code === null || code === undefined
}
