/**
 * Format CLI failure for launcher UI (localized, no raw JSON).
 * Missing-scope can auto-start auth login and return open-URL choices.
 */

import type { LarkCliShell } from './run'
import { completeLogin, startLogin } from '../domains/auth'

export type FeishuCliFailure = {
  message?: string
  hint?: string
  code?: string | number
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

type ToolOutputLike = {
  error: (message: string) => unknown
  choices: (choices: Array<{
    id: string
    title: string
    subtitle?: string
    icon?: string
    primaryAction: () => Promise<{ ok: true; message?: string } | { ok: false; message: string }>
  }>) => unknown
  text?: (value: string) => unknown
}

export function formatFeishuCliFailure(
  t: Translate,
  failure: FeishuCliFailure,
  fallbackKey: string,
): string {
  const code = failure.code != null ? String(failure.code) : ''
  const scopes = extractScopesFromText(failure.message, failure.hint)

  if (code === 'missing_scope' || scopes.length > 0) {
    const scopeText = scopes.length > 0 ? scopes.join(', ') : ''
    const lines = [
      scopeText
        ? t('error.missingScope', { scopes: scopeText })
        : t('error.missingScopeGeneric'),
    ]
    if (scopeText) {
      lines.push(t('error.missingScopeHint', { scopes: scopeText }))
    } else if (failure.hint) {
      lines.push(shortHint(failure.hint))
    }
    return lines.filter(Boolean).join('\n')
  }

  if (code === 'not_installed') {
    return t('error.notInstalled')
  }
  if (code === 'not_logged_in' || /not logged|not login|unauthoriz/i.test(failure.message ?? '')) {
    return [t('error.notLoggedIn'), failure.hint ? shortHint(failure.hint) : '']
      .filter(Boolean)
      .join('\n')
  }

  const msg = failure.message?.trim()
  // Never dump CLI JSON envelopes into the UI
  if (msg && !looksLikeJson(msg)) {
    return [msg, failure.hint ? shortHint(failure.hint) : ''].filter(Boolean).join('\n')
  }

  return [t(fallbackKey), failure.hint ? shortHint(failure.hint) : ''].filter(Boolean).join('\n')
}

/**
 * Prefer interactive recovery for missing scopes: run auth login --no-wait,
 * open verification URL, offer complete-login choice.
 */
export async function presentFeishuCliFailure(options: {
  t: Translate
  output: ToolOutputLike
  failure: FeishuCliFailure
  fallbackKey: string
  shell?: LarkCliShell | null
  binaryPath?: string
  openUrl: (url: string) => Promise<void>
}): Promise<unknown> {
  const { t, output, failure, fallbackKey, shell, binaryPath, openUrl } = options
  const scopes = extractScopesFromText(failure.message, failure.hint)
  const isMissingScope =
    String(failure.code ?? '') === 'missing_scope' || scopes.length > 0

  if (isMissingScope && shell) {
    const started = await startLogin(shell, binaryPath, undefined, scopes)
    if (started.ok && started.verificationUrl) {
      const url = started.verificationUrl
      // Auto-open auth page once
      try {
        await openUrl(url)
      } catch {
        // still show choices
      }

      const scopeText = scopes.length > 0 ? scopes.join(', ') : ''
      return output.choices([
        {
          id: 'feishu.auth:hint',
          title: t('auth.missingScopeTitle'),
          subtitle: scopeText
            ? t('auth.missingScopeBody', { scopes: scopeText })
            : t('auth.missingScopeBodyGeneric'),
          icon: 'ShieldAlert',
          primaryAction: async () => ({
            ok: true as const,
            message: t('auth.missingScopeGuide'),
          }),
        },
        {
          id: 'feishu.auth:reopen-url',
          title: t('action.openAuthUrl'),
          subtitle: t('action.openAuthUrlHint'),
          icon: 'ExternalLink',
          primaryAction: async () => {
            try {
              await openUrl(url)
              return { ok: true as const, message: t('login.urlOpened') }
            } catch (error) {
              return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
              }
            }
          },
        },
        {
          id: 'feishu.auth:complete',
          title: t('action.completeAuth'),
          subtitle: t('action.completeAuthHint'),
          icon: 'Check',
          primaryAction: async () => {
            const done = await completeLogin(shell, {
              binaryPath,
              deviceCode: started.deviceCode,
            })
            if (!done.ok) {
              return {
                ok: false as const,
                message: done.message || t('login.failed'),
              }
            }
            return { ok: true as const, message: t('login.done') }
          },
        },
      ])
    }
  }

  return output.error(formatFeishuCliFailure(t, failure, fallbackKey))
}

function looksLikeJson(text: string): boolean {
  const t = text.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function shortHint(hint: string): string {
  const m = hint.match(/lark-cli auth login[^\n]*/i)
  if (m?.[0]) return m[0].replace(/\\"/g, '"').slice(0, 200)
  return hint.replace(/\s+/g, ' ').slice(0, 200)
}

export function extractScopesFromText(...texts: Array<string | undefined>): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    for (const m of text.matchAll(/([a-z][a-z0-9_]*(?::[a-z0-9_.]+)+)/gi)) {
      if (m[1] && m[1].includes(':')) found.add(m[1])
    }
  }
  return [...found]
}
