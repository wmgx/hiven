/**
 * B5: best-effort focus of an already-open Feishu/Lark window by title.
 * Uses host shell.run → osascript (macOS). Never throws; miss falls through to open URL.
 */

import type { LarkCliShell } from '../cli/run'

/** Process names that may own Feishu / Lark desktop windows on macOS. */
export const FEISHU_WINDOW_APP_NAMES = ['Feishu', 'Lark', '飞书', 'LarkSuite'] as const

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
 * **Always open URL first** (fast path). Optional window focus runs in the
 * background so osascript never delays document / chat open.
 */
export async function openFeishuTarget(options: {
  shell?: LarkCliShell | null
  openUrl: (url: string) => Promise<void>
  url: string
  titleHint?: string
  preferWindowFocus?: boolean
}): Promise<'opened'> {
  await options.openUrl(options.url)

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

function shellQuote(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:=+@%,-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
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
