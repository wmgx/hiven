/**
 * B5: best-effort focus of an already-open Feishu/Lark window by title.
 * Uses host shell.run → osascript (macOS). Never throws; miss falls through to open URL.
 *
 * Chat open follows official AppLink docs (open.feishu.cn):
 *   lark://applink.feishu.cn/client/chat/open?openChatId=… | openId=…
 *   https://applink.feishu.cn/client/chat/open?…
 *
 * Critical delivery rule on macOS:
 *   Do NOT open https AppLink after a native scheme open when shell is available.
 *   Default browser (e.g. Edge) steals focus and cancels client navigation.
 *   Prefer client scheme only; https is fallback when shell is missing.
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

  const short = hint.length > 24 ? hint.slice(0, 24) : hint
  if (short.length >= 4 && win.includes(short)) return 50 + Math.min(20, short.length)

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

  const needle = options.titleHint.replace(/[\r\n\u0000]/g, ' ').trim().slice(0, 80)
  if (!needle) return false

  const script = buildFocusAppleScript(needle)
  try {
    const result = await options.shell.run({
      command: `osascript -e ${shellQuote(script)}`,
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
 * Open a Feishu resource (chat / doc / …).
 *
 * Chat: client AppLink scheme only when shell is available (avoid browser steal).
 * Docs / other https: host openUrl.
 */
export async function openFeishuTarget(options: {
  shell?: LarkCliShell | null
  openUrl?: ((url: string) => Promise<void>) | null
  url: string
  /** Extra candidate URLs (e.g. openId form after openChatId). Tried after `url`. */
  alternateUrls?: string[]
  titleHint?: string
  preferWindowFocus?: boolean
}): Promise<'opened'> {
  const urls = dedupeUrls([options.url, ...(options.alternateUrls ?? [])])
  await openFeishuClientOrUrl({
    shell: options.shell,
    openUrl: options.openUrl ?? null,
    urls,
  })

  if (
    options.preferWindowFocus !== false &&
    options.shell &&
    options.titleHint &&
    options.titleHint.trim().length >= 2
  ) {
    void tryFocusFeishuWindowByTitle({
      shell: options.shell,
      titleHint: options.titleHint,
      timeoutMs: 900,
    }).catch(() => {})
  }

  return 'opened'
}

/**
 * Normalize open URL for delivery.
 * Chat deep links → official https AppLink string form (for coerce / storage).
 */
export function normalizeFeishuOpenUrl(url: string): string {
  const raw = url.trim()
  if (!raw) return raw
  const https = coerceHttpsApplink(raw)
  if (https) return https
  return raw.replace(
    /^(lark|feishu|x-feishu|x-lark):\/\/\/+(client\/)/i,
    '$1://$2',
  )
}

/** Pure: known chat deep links → https://applink…/client/chat/open?… */
export function coerceHttpsApplink(url: string): string | null {
  const raw = url.trim()
  if (!raw) return null
  if (/^https:\/\/applink\.(feishu\.cn|larksuite\.com)\/client\/chat\/open\?/i.test(raw)) {
    return raw
  }

  const host = /larksuite/i.test(raw) ? 'applink.larksuite.com' : 'applink.feishu.cn'

  const native = raw.match(
    /^(?:lark|feishu|x-feishu|x-lark):\/\/(?:applink\.(?:feishu\.cn|larksuite\.com)\/)?client\/chat\/open\?(.+)$/i,
  )
  if (native) return `https://${host}/client/chat/open?${native[1]}`

  const broken = raw.match(
    /^(?:lark|feishu|x-feishu|x-lark):\/\/\/+client\/chat\/open\?(.+)$/i,
  )
  if (broken) return `https://${host}/client/chat/open?${broken[1]}`

  return null
}

/**
 * https AppLink → custom scheme with applink host (docs structure).
 * https://applink.feishu.cn/client/… → lark://applink.feishu.cn/client/…
 */
export function coerceNativeApplink(url: string, scheme: 'lark' | 'feishu' = 'lark'): string | null {
  const https = coerceHttpsApplink(url)
  if (!https) return null
  return https.replace(/^https:\/\//i, `${scheme}://`)
}

/** Expand one chat URL into lark/feishu native candidates. */
export function expandNativeChatCandidates(url: string): string[] {
  const https = coerceHttpsApplink(url)
  if (!https) return []
  const out: string[] = []
  for (const scheme of ['lark', 'feishu'] as const) {
    const native = coerceNativeApplink(https, scheme)
    if (native) out.push(native)
  }
  return out
}

async function fallbackOpenViaShell(url: string, shell: LarkCliShell): Promise<void> {
  await shell.run({
    command: `open ${shellQuote(url)}`,
    timeoutMs: 2500,
  })
}

async function openFeishuClientOrUrl(options: {
  shell?: LarkCliShell | null
  openUrl?: ((url: string) => Promise<void>) | null
  urls: string[]
}): Promise<void> {
  const shell = options.shell
  const hostOpen = options.openUrl

  const chatNatives: string[] = []
  const nonChat: string[] = []
  for (const raw of options.urls) {
    const https = normalizeFeishuOpenUrl(raw)
    if (!https) continue
    if (coerceHttpsApplink(https)) {
      chatNatives.push(...expandNativeChatCandidates(https))
    } else {
      nonChat.push(https)
    }
  }
  const natives = dedupeUrls(chatNatives)

  // ── Chat: client scheme only when shell available ────────────────────────
  // Opening https AppLink after native causes Edge/Chrome to steal focus and
  // abort Feishu navigation on many multi-browser macOS setups.
  //
  // `open` often exits 0 without navigating — try every candidate once via
  // bundle-id delivery, then stop (do not fall through to https).
  if (natives.length > 0 && shell) {
    for (const native of natives) {
      try {
        await shell.run({
          command: `open -b com.electron.lark ${shellQuote(native)}`,
          timeoutMs: 2500,
        })
      } catch {
        // try next candidate
      }
    }
    // One LaunchServices fallback on the first candidate.
    try {
      await shell.run({
        command: `open ${shellQuote(natives[0])}`,
        timeoutMs: 2500,
      })
    } catch {
      // ignore
    }
    // Soft raise after a beat so we don't race the deep-link handler.
    setTimeout(() => {
      void raiseFeishuProcess(shell)
    }, 400)
    return
  }

  // ── Fallback: https AppLink via host openUrl (docs PC intermediate page) ──
  const httpsFallback = dedupeUrls(
    options.urls.map((u) => normalizeFeishuOpenUrl(u)).filter(Boolean),
  )
  const primaryHttps =
    httpsFallback.find((u) => coerceHttpsApplink(u)) ?? httpsFallback[0] ?? nonChat[0]
  if (!primaryHttps) {
    throw new Error('No Feishu open URL')
  }

  if (hostOpen) {
    await hostOpen(primaryHttps)
  } else if (shell) {
    await fallbackOpenViaShell(primaryHttps, shell)
  } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(primaryHttps, '_blank')
  } else {
    throw new Error('No openUrl / shell available to open Feishu link')
  }

  // Non-chat extras (docs etc.)
  for (const url of nonChat) {
    if (url === primaryHttps) continue
    try {
      if (hostOpen) await hostOpen(url)
      else if (shell) await fallbackOpenViaShell(url, shell)
    } catch {
      // ignore secondary failures
    }
  }

  if (shell) void raiseFeishuProcess(shell)
}

/** Raise Feishu/Lark process without title matching. */
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

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const t = u.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * AppleScript: among Feishu/Lark processes, raise first window whose name contains needle.
 */
function buildFocusAppleScript(needle: string): string {
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
