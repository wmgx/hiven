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
 * Native schemes (`lark://` / `feishu://`) go through macOS `open` so the
 * desktop client launches directly — not Safari/Chrome via https applink.
 * Optional window title focus runs in the background after open.
 */
export async function openFeishuTarget(options: {
  shell?: LarkCliShell | null
  openUrl: (url: string) => Promise<void>
  url: string
  titleHint?: string
  preferWindowFocus?: boolean
}): Promise<'opened'> {
  await openFeishuClientOrUrl({
    shell: options.shell,
    openUrl: options.openUrl,
    url: options.url,
  })

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

/**
 * Normalize chat deep links so cached / older applink-host forms still open.
 * `lark://applink.feishu.cn/client/...` can be handed to the browser; rewrite to
 * bare `lark://client/...` which LaunchServices delivers into Feishu.
 */
export function normalizeFeishuOpenUrl(url: string): string {
  const raw = url.trim()
  if (!raw) return raw
  // lark://applink.feishu.cn/client/chat/open?... → lark://client/chat/open?...
  const rewritten = raw.replace(
    /^(lark|feishu|x-feishu|x-lark):\/\/applink\.(?:feishu\.cn|larksuite\.com)(\/client\/)/i,
    '$1://$2',
  )
  return rewritten
}

async function openFeishuClientOrUrl(options: {
  shell?: LarkCliShell | null
  openUrl: (url: string) => Promise<void>
  url: string
}): Promise<void> {
  const url = normalizeFeishuOpenUrl(options.url)
  const isClient = /^(lark|feishu|x-feishu|x-lark):\/\//i.test(url)

  // macOS delivery notes (empirically):
  // - `open <scheme-url>` hits LaunchServices and delivers to the running
  //   Feishu/Lark instance (process name is often "Feishu" even when the
  //   bundle is Lark.app).
  // - `open -a /Applications/Lark.app <url>` returns exit 0 but frequently
  //   does NOT deliver the URL when the app is already running — that was
  //   the "jump to chat is broken" regression. Prefer plain `open` first.
  // - AppleScript `open location` via bundle id is a strong second path.
  if (isClient && options.shell) {
    const candidates = [
      // 1) System scheme handler (running instance + cold start).
      `open ${shellQuote(url)}`,
      // 2) Bundle-id open location — forces delivery into com.electron.lark.
      buildOpenLocationScript(url),
      // 3) Cold-start / multi-install last resort only.
      `open -a ${shellQuote('/Applications/Lark.app')} ${shellQuote(url)}`,
    ]
    for (const command of candidates) {
      try {
        const result = await options.shell.run({
          command,
          timeoutMs: 2500,
        })
        if (!result.timedOut && (result.exitCode === 0 || result.exitCode == null)) {
          // Best-effort raise Feishu after URL delivery (does not block).
          void raiseFeishuProcess(options.shell)
          return
        }
      } catch {
        // try next candidate
      }
    }
  }

  await options.openUrl(url)
  if (options.shell) void raiseFeishuProcess(options.shell)
}

/** AppleScript: deliver URL into the Feishu/Lark desktop app by bundle id. */
function buildOpenLocationScript(url: string): string {
  const escaped = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  // Bundle id is stable across Lark.app / Feishu branding on CN desktop.
  const script = [
    'try',
    '  tell application id "com.electron.lark"',
    '    activate',
    `    open location "${escaped}"`,
    '  end tell',
    'end try',
  ].join('\n')
  return `osascript -e ${shellQuote(script)}`
}

/** Raise Feishu/Lark process without title matching (chat open already routed). */
async function raiseFeishuProcess(shell: LarkCliShell): Promise<void> {
  try {
    await shell.run({
      command: [
        'osascript -e',
        shellQuote(
          [
            'tell application "System Events"',
            '  repeat with pname in {"Feishu", "Lark", "飞书", "LarkSuite"}',
            '    try',
            '      if exists process (pname as text) then',
            '        set frontmost of process (pname as text) to true',
            '        return "raised"',
            '      end if',
            '    end try',
            '  end repeat',
            'end tell',
          ].join('\n'),
        ),
      ].join(' '),
      timeoutMs: 800,
    })
  } catch {
    // ignore
  }
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
