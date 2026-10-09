import type { AiProviderLogin } from './types'

const CODEX_LOGIN_PARAMS = new Set([
  'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method',
  'id_token_add_organizations', 'codex_cli_simplified_flow', 'originator', 'allowed_workspace_id',
])

/** Only the official authorization request may be held for manual browser handoff. */
export function isSafeCodexLoginUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 16_384 || /[^\x21-\x7e]|[\\#]/.test(value)) return false
  const authority = /^https:\/\/([^/?#]+)(?:[/?]|$)/.exec(value)?.[1]
  if (authority !== 'auth.openai.com' && authority !== 'auth.openai.com:443') return false
  try {
    const url = new URL(value)
    if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/oauth/authorize'
      || url.username || url.password || url.hash) return false
    const seen = new Set<string>()
    for (const [name, value] of url.searchParams) {
      if (!CODEX_LOGIN_PARAMS.has(name) || seen.has(name)) return false
      seen.add(name)
      if (name === 'response_type' && value !== 'code') return false
      if (name === 'code_challenge_method' && value !== 'S256') return false
      if ((name === 'id_token_add_organizations' || name === 'codex_cli_simplified_flow') && value !== 'true' && value !== 'false') return false
    }
    return seen.has('response_type')
  } catch {
    return false
  }
}

export type AiLoginSessionSnapshot = Readonly<{
  generation: number
  phase: 'idle' | 'starting' | 'pending'
  url?: string
  loginId?: string
  reason?: 'success' | 'cancelled' | 'timeout' | 'error' | 'disposed'
}>

/** A settings-surface lifetime only: never persist, log, or place this state in a store. */
export function createAiLoginSession(options: {
  start: () => Promise<AiProviderLogin>
  cancel?: (loginId: string) => Promise<void>
  onChange: (snapshot: AiLoginSessionSnapshot) => void
  timeoutMs?: number
}) {
  let snapshot: AiLoginSessionSnapshot = Object.freeze({ generation: 0, phase: 'idle' })
  let inFlight: Promise<AiLoginSessionSnapshot | undefined> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function publish(next: AiLoginSessionSnapshot) {
    snapshot = Object.freeze(next)
    if (!disposed) options.onChange(snapshot)
  }

  function clear(reason: AiLoginSessionSnapshot['reason']) {
    const loginId = snapshot.loginId
    clearTimeout(timer)
    timer = undefined
    inFlight = undefined
    publish({ generation: snapshot.generation + 1, phase: 'idle', reason })
    return loginId
  }

  async function cancelLogin(loginId?: string) {
    if (!loginId || !options.cancel) return
    try { await options.cancel(loginId) } catch { throw new Error('AI_LOGIN_CANCEL_FAILED') }
  }

  return {
    getSnapshot: () => snapshot,
    start(): Promise<AiLoginSessionSnapshot | undefined> {
      if (disposed) return Promise.resolve(undefined)
      if (inFlight) return inFlight
      if (snapshot.phase === 'pending') return Promise.resolve(snapshot)
      const generation = snapshot.generation + 1
      const current = () => !disposed && snapshot.generation === generation && snapshot.phase === 'starting'
      inFlight = Promise.resolve().then(() => current() ? options.start() : undefined).then((result) => {
        if (!result) return undefined
        if (!current()) {
          void cancelLogin(result.loginId).catch(() => {})
          return undefined
        }
        if (!isSafeCodexLoginUrl(result.url)) {
          void cancelLogin(result.loginId).catch(() => {})
          throw new Error('AI_LOGIN_URL_INVALID')
        }
        inFlight = undefined
        publish({ generation, phase: 'pending', url: result.url, loginId: result.loginId })
        return snapshot
      }).catch(() => {
        if (!current()) return undefined
        clear('error')
        // Native errors can contain the authorization URL or response body.
        throw new Error('AI_LOGIN_START_FAILED')
      })
      publish({ generation, phase: 'starting' })
      timer = setTimeout(() => {
        if (snapshot.generation !== generation || disposed) return
        const loginId = clear('timeout')
        void cancelLogin(loginId).catch(() => {})
      }, options.timeoutMs ?? 300_000)
      return inFlight
    },
    finish(generation: number): boolean {
      if (disposed || snapshot.generation !== generation || snapshot.phase !== 'pending') return false
      clear('success')
      return true
    },
    cancel(): Promise<void> {
      if (disposed) return Promise.resolve()
      return cancelLogin(clear('cancelled'))
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      void cancelLogin(clear('disposed')).catch(() => {})
    },
  }
}
