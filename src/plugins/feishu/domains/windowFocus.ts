/**
 * B5: best-effort focus of an already-open Feishu/Lark window by title.
 * Uses host shell.run → osascript (macOS). Never throws; miss falls through to open URL.
 */

import type { LarkCliShell } from '../cli/run'
import {
  buildDeliveryCandidates,
  isClientScheme,
  shellQuote,
  shouldStopAfterDelivery,
} from './openPlan'

/** Process names that may own Feishu / Lark desktop windows on macOS. */
export const FEISHU_WINDOW_APP_NAMES = ['Feishu', 'Lark', '飞书', 'LarkSuite'] as const

/** Bundle ids that may own the Feishu / Lark desktop client. */
const FEISHU_BUNDLE_IDS = [
  'com.electron.lark',
  'com.bytedance.ee.lark',
  'com.larksuite.desktop',
] as const

/** Cached resolution so we spawn `mdfind` at most once per session. */
let resolvedAppPath: string | null | undefined

/**
 * Resolve the installed Feishu / Lark .app path.
 *
 * Returns undefined when nothing resolves, in which case delivery falls back
 * to plain LaunchServices + bundle id. Never throws.
 */
export async function resolveFeishuAppPath(shell: LarkCliShell): Promise<string | undefined> {
  if (resolvedAppPath !== undefined) return resolvedAppPath ?? undefined

  for (const bundleId of FEISHU_BUNDLE_IDS) {
    try {
      // No pipes / redirects: LarkCliShell.run only guarantees a command string,
      // not a full shell. Take the first line in JS instead.
      const result = await shell.run({
        command: `mdfind kMDItemCFBundleIdentifier=${bundleId}`,
        timeoutMs: 1500,
      })
      const path = (result.stdout ?? '')
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.endsWith('.app'))
      if (path) {
        logFeishuOpen('resolveApp:hit', { bundleId, path })
        resolvedAppPath = path
        return path
      }
    } catch {
      // try next bundle id
    }
  }

  logFeishuOpen('resolveApp:miss', { tried: FEISHU_BUNDLE_IDS.length })
  resolvedAppPath = null
  return undefined
}

/** Test seam: drop the cached app path so the next open re-resolves. */
export function resetFeishuAppPathCache(): void {
  resolvedAppPath = undefined
}

const OPEN_LOG = '[feishu:open]'
const OPEN_LOG_MAX = 80

export type FeishuOpenLogEntry = {
  at: number
  step: string
  details?: Record<string, unknown>
}

const openLogRing: FeishuOpenLogEntry[] = []

/** Structured open-path logs — filter DevTools / tauri console by `feishu:open`. */
export function logFeishuOpen(step: string, details?: Record<string, unknown>): void {
  const entry: FeishuOpenLogEntry = {
    at: Date.now(),
    step,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  }
  openLogRing.push(entry)
  while (openLogRing.length > OPEN_LOG_MAX) openLogRing.shift()

  if (details && Object.keys(details).length > 0) {
    console.info(OPEN_LOG, step, details)
  } else {
    console.info(OPEN_LOG, step)
  }
}

/** Recent open-path steps for the in-app debug tool (newest last). */
export function getFeishuOpenLogDump(limit = 40): FeishuOpenLogEntry[] {
  const n = Math.max(1, Math.min(OPEN_LOG_MAX, limit))
  return openLogRing.slice(-n)
}

export function clearFeishuOpenLogs(): void {
  openLogRing.length = 0
}

/** Format ring buffer as plain text for launcher output. */
export function formatFeishuOpenLogDump(limit = 40): string {
  const rows = getFeishuOpenLogDump(limit)
  if (rows.length === 0) return '(no feishu:open logs yet)'
  return rows
    .map((row) => {
      const t = new Date(row.at).toISOString().slice(11, 23)
      const detail =
        row.details && Object.keys(row.details).length > 0
          ? ' ' + JSON.stringify(row.details)
          : ''
      return `${t} ${row.step}${detail}`
    })
    .join('\n')
}

/**
 * Normalize for fuzzy contains matching.
 */
export function normalizeTitleHint(text: string): string {
  return text
    .replace(/<\/?h\b[^>]*>/gi, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Score how well a window title matches a document/event title hint.
 * Higher is better; 0 = no match.
 */
export function scoreWindowTitleMatch(windowTitle: string, titleHint: string): number {
  const win = normalizeTitleHint(windowTitle)
  const hint = normalizeTitleHint(titleHint)
  if (!win || !hint) return 0
  if (win === hint) return 100
  if (win.includes(hint)) return 80 + Math.min(19, hint.length)
  if (hint.includes(win) && win.length >= 4) return 60 + Math.min(19, win.length)

  // Prefix / significant substring (≥4 chars)
  const short = hint.length > 24 ? hint.slice(0, 24) : hint
  if (short.length >= 4 && win.includes(short)) return 50 + Math.min(20, short.length)

  // Token overlap
  const hintTokens = short.split(/[\s\-_|/·:：]+/).filter((t) => t.length >= 2)
  if (hintTokens.length === 0) return 0
  let hits = 0
  for (const token of hintTokens) {
    if (win.includes(token)) hits += 1
  }
  if (hits === 0) return 0
  return Math.min(49, Math.round((hits / hintTokens.length) * 40) + hits)
}

export function isFeishuLikeAppName(appName: string): boolean {
  const n = appName.trim().toLowerCase()
  if (!n) return false
  return (
    n === 'feishu' ||
    n === 'lark' ||
    n === '飞书' ||
    n.includes('feishu') ||
    n.includes('lark') ||
    n.includes('飞书')
  )
}

export type DesktopWindowLike = {
  id?: string
  appName: string
  title: string
}

/**
 * Pick best matching Feishu/Lark window for a title hint (pure, testable).
 */
export function pickBestFeishuWindow(
  windows: DesktopWindowLike[],
  titleHint: string,
  minScore = 50,
): DesktopWindowLike | null {
  const hint = normalizeTitleHint(titleHint)
  if (!hint) return null

  let best: DesktopWindowLike | null = null
  let bestScore = 0
  for (const win of windows) {
    if (!isFeishuLikeAppName(win.appName)) continue
    const score = scoreWindowTitleMatch(win.title, hint)
    if (score > bestScore) {
      bestScore = score
      best = win
    }
  }
  if (!best || bestScore < minScore) return null
  return best
}

/**
 * Try to raise a Feishu/Lark window whose title fuzzy-matches titleHint.
 * Returns true only when osascript reports a focused window.
 */
export async function tryFocusFeishuWindowByTitle(options: {
  shell: LarkCliShell
  titleHint: string
  timeoutMs?: number
}): Promise<boolean> {
  const hint = normalizeTitleHint(options.titleHint)
  if (!hint || hint.length < 2) return false

  // Cap length for AppleScript safety / performance
  const needle = options.titleHint.replace(/[\r\n\u0000]/g, ' ').trim().slice(0, 80)
  if (!needle) return false

  const script = buildFocusAppleScript(needle)
  try {
    const result = await options.shell.run({
      command: `osascript -e ${shellQuote(script)}`,
      // Keep short: must never block openUrl on the critical path.
      timeoutMs: options.timeoutMs ?? 900,
    })
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.toLowerCase()
    if (result.timedOut) return false
    return out.includes('focused')
  } catch {
    return false
  }
}

/**
 * Open a Feishu resource.
 * Restored last-known-good path (5a490c6 era):
 *   URL: lark://applink.feishu.cn/client/chat/open?…
 *   Delivery: plain `open <url>` (running instance), then `open -a Lark.app`
 * Optional window title focus runs in the background after open.
 */
export async function openFeishuTarget(options: {
  shell?: LarkCliShell | null
  openUrl?: ((url: string) => Promise<void>) | null
  url: string
  titleHint?: string
  preferWindowFocus?: boolean
}): Promise<'opened'> {
  logFeishuOpen('openFeishuTarget:start', {
    url: options.url,
    hasShell: Boolean(options.shell),
    hasOpenUrl: Boolean(options.openUrl),
    titleHint: options.titleHint ?? null,
    preferWindowFocus: options.preferWindowFocus !== false,
  })
  try {
    await openFeishuClientOrUrl({
      shell: options.shell,
      openUrl: options.openUrl ?? null,
      url: options.url,
    })
    logFeishuOpen('openFeishuTarget:done', { url: options.url })
  } catch (error) {
    logFeishuOpen('openFeishuTarget:error', {
      url: options.url,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  if (
    options.preferWindowFocus !== false &&
    options.shell &&
    options.titleHint &&
    options.titleHint.trim().length >= 2
  ) {
    // Fire-and-forget: raise matching client window after URL is already opening.
    void tryFocusFeishuWindowByTitle({
      shell: options.shell,
      titleHint: options.titleHint,
      timeoutMs: 900,
    }).catch(() => {})
  }

  return 'opened'
}

async function openFeishuClientOrUrl(options: {
  shell?: LarkCliShell | null
  openUrl?: ((url: string) => Promise<void>) | null
  url: string
}): Promise<void> {
  const url = options.url.trim()
  if (!url) {
    logFeishuOpen('openFeishuClientOrUrl:empty-url')
    return
  }
  const isClient = isClientScheme(url)
  logFeishuOpen('openFeishuClientOrUrl:dispatch', {
    url,
    isClient,
    hasShell: Boolean(options.shell),
    hasOpenUrl: Boolean(options.openUrl),
  })

  // Client schemes: deliver via shell so the deep link reaches the desktop
  // client. Host openUrl is a generic OS open and may only activate the app.
  if (isClient && options.shell) {
    const appPath = await resolveFeishuAppPath(options.shell)
    const candidates = buildDeliveryCandidates(url, { appPath })

    for (const candidate of candidates) {
      try {
        logFeishuOpen('shell.run:try', { command: candidate.command, reason: candidate.reason })
        const result = await options.shell.run({
          command: candidate.command,
          timeoutMs: 2500,
        })
        logFeishuOpen('shell.run:result', {
          command: candidate.command,
          reason: candidate.reason,
          exitCode: result.exitCode ?? null,
          timedOut: Boolean(result.timedOut),
          stdout: (result.stdout ?? '').slice(0, 200),
          stderr: (result.stderr ?? '').slice(0, 200),
        })

        // Stop on first success: delivering the same deep link twice makes the
        // client re-handle the URL and can reset an already-navigated window.
        if (shouldStopAfterDelivery(result)) {
          logFeishuOpen('shell.run:accepted', {
            command: candidate.command,
            reason: candidate.reason,
          })
          return
        }
      } catch (error) {
        logFeishuOpen('shell.run:throw', {
          command: candidate.command,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logFeishuOpen('shell.run:all-failed', { url, candidateCount: candidates.length })
  } else if (isClient && !options.shell) {
    logFeishuOpen('shell.missing-for-client-scheme', { url })
  }

  // Host openUrl: registered custom schemes → open_system_url; https → shell.open.
  if (options.openUrl) {
    try {
      logFeishuOpen('host.openUrl:try', { url })
      await options.openUrl(url)
      logFeishuOpen('host.openUrl:ok', { url })
      return
    } catch (error) {
      logFeishuOpen('host.openUrl:error', {
        url,
        message: error instanceof Error ? error.message : String(error),
      })
      if (!isClient) throw error
    }
  }

  logFeishuOpen('abort:no-openUrl-no-shell', { url })
  throw new Error('No openUrl / shell available to open Feishu link')
}

/**
 * AppleScript: among Feishu/Lark processes, raise first window whose name contains needle
 * (case-insensitive via lowercase compare). Returns "focused" or "miss".
 */
function buildFocusAppleScript(needle: string): string {
  // Escape for AppleScript string literal
  const escaped = needle.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    'set needle to "' + escaped + '"',
    'set needleLower to do shell script "printf %s " & quoted form of needle & " | tr \'[:upper:]\' \'[:lower:]\'"',
    'set appNames to {"Feishu", "Lark", "飞书", "LarkSuite"}',
    'tell application "System Events"',
    '  repeat with pname in appNames',
    '    try',
    '      if exists process (pname as text) then',
    '        tell process (pname as text)',
    '          repeat with w in windows',
    '            try',
    '              set wname to name of w as text',
    '              set wLower to do shell script "printf %s " & quoted form of wname & " | tr \'[:upper:]\' \'[:lower:]\'"',
    '              if wLower contains needleLower then',
    '                set frontmost to true',
    '                try',
    '                  perform action "AXRaise" of w',
    '                end try',
    '                return "focused"',
    '              end if',
    '            end try',
    '          end repeat',
    '        end tell',
    '      end if',
    '    end try',
    '  end repeat',
    'end tell',
    'return "miss"',
  ].join('\n')
}
