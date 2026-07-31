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

/**
 * Collapse a process executable path to its enclosing .app bundle root.
 * `/Applications/Lark.app/Contents/MacOS/Feishu` → `/Applications/Lark.app`
 */
export function normalizeToAppBundle(path: string): string | undefined {
  const trimmed = path.trim()
  if (!trimmed) return undefined
  const match = trimmed.match(/^(.*\.app)(?:\/|$)/i)
  return match?.[1]
}

/**
 * Choose which .app should be addressed by name (`open -a`) for a deep link.
 *
 * Returns a path ONLY when exactly one Feishu/Lark client is running, because
 * that is the one case with an unambiguous answer: the user has a live session
 * and it can only be that one.
 *
 * Everything else returns undefined on purpose. Multiple installs routinely
 * share both the bundle id (`com.electron.lark`) and the bundle name
 * (`Feishu`), so nothing about an install identifies it as "the real one" —
 * ranking them by file name would just be a guess wearing a score. When it is
 * ambiguous we drop `open -a` and let LaunchServices apply the user's default
 * handler, which is at least consistent with every other place they click a
 * Feishu link.
 */
export function pickDeliveryAppPath(runningAppPaths: readonly string[]): string | undefined {
  const running = uniqueAppBundles(runningAppPaths)
  return running.length === 1 ? running[0] : undefined
}

function uniqueAppBundles(paths: readonly string[] | undefined): string[] {
  if (!paths || paths.length === 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const app = normalizeToAppBundle(raw)
    if (!app || seen.has(app)) continue
    seen.add(app)
    out.push(app)
  }
  return out
}

/**
 * Extract Feishu/Lark .app bundle paths from `ps -ax -o comm=` output.
 */
export function collectRunningAppPathsFromPs(stdout: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!/feishu|lark|飞书/i.test(trimmed)) continue
    // Skip Electron helper apps under Frameworks — only the product bundle.
    // e.g. …/Lark.app/Contents/Frameworks/…Helper.app must not win over Lark.app.
    if (/\/Contents\/Frameworks\//i.test(trimmed)) continue
    const app = normalizeToAppBundle(trimmed)
    if (!app || seen.has(app)) continue
    seen.add(app)
    out.push(app)
  }
  return out
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
 * Order matters. When `appPath` is set it means exactly one client is running,
 * so addressing it directly lands the link in the session the user already has
 * open. Without it we ask LaunchServices instead of picking an install
 * ourselves — see `pickDeliveryAppPath`. The bundle id is a last resort for
 * when no handler is registered at all.
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
