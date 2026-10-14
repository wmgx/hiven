export type HudTranslationPhase = 'idle' | 'translating' | 'ready' | 'active' | 'cancelled' | 'error'

export type HudTranslationView = {
  sessionId: string
  revision: number
  phase: Exclude<HudTranslationPhase, 'idle'>
  preview: string
  truncated: boolean
  copyFailed: boolean
  complete: boolean
  expiresAt: number
}

export type HudTranslationPreparedRun = {
  translate(input: string, options: { signal: AbortSignal; onText(text: string): void }): Promise<string>
}

export type HudTranslationDependencies = {
  /** Resolve settings/readiness before any clipboard content is read. */
  prepare(): Promise<HudTranslationPreparedRun | null>
  readClipboard(signal: AbortSignal): Promise<string>
  isSensitive(text: string): boolean
  writeClipboard(text: string, signal: AbortSignal): Promise<void>
  present(view: HudTranslationView): Promise<void> | void
  activate(view: HudTranslationView): Promise<boolean>
  dismiss(sessionId: string, revision: number): Promise<void> | void
  now(): number
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearSchedule(timer: ReturnType<typeof setTimeout>): void
  randomId(): string
}

export type HudTranslationSessionOptions = {
  ttlMs?: number
  previewCharacters?: number
  maxInputCharacters?: number
}

type LiveSession = {
  id: string
  revision: number
  phase: Exclude<HudTranslationPhase, 'idle'>
  controller: AbortController
  output: string
  copyFailed: boolean
  complete: boolean
  expiresAt: number
  timer?: ReturnType<typeof setTimeout>
  copying: boolean
  activating: boolean
  delivery: Promise<void>
}

const DEFAULT_TTL_MS = 15_000
const DEFAULT_PREVIEW_CHARACTERS = 320
const DEFAULT_MAX_INPUT_CHARACTERS = 12_000
// The native HUD is process-global, so delivery must remain ordered even when
// the host is torn down and creates a replacement session controller.
let nativeDelivery: Promise<void> = Promise.resolve()

function boundedPreview(text: string, limit: number): { preview: string; truncated: boolean } {
  const characters = Array.from(text)
  return characters.length <= limit
    ? { preview: text, truncated: false }
    : { preview: characters.slice(0, limit).join(''), truncated: true }
}

/** One in-memory translation owned outside React surfaces. */
export class HudTranslationSession {
  private readonly dependencies: HudTranslationDependencies
  private readonly ttlMs: number
  private readonly previewCharacters: number
  private readonly maxInputCharacters: number
  private live: LiveSession | null = null
  private preparing = false
  private triggerQueue: Promise<'started' | 'cancelled' | 'activated' | 'unavailable' | 'rejected'> = Promise.resolve('unavailable')

  constructor(dependencies: HudTranslationDependencies, options: HudTranslationSessionOptions = {}) {
    this.dependencies = dependencies
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.previewCharacters = options.previewCharacters ?? DEFAULT_PREVIEW_CHARACTERS
    this.maxInputCharacters = options.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS
  }

  /** First press starts passively; a second press explicitly activates the live HUD. */
  trigger(): Promise<'started' | 'cancelled' | 'activated' | 'unavailable' | 'rejected'> {
    const current = this.live
    if (current && (current.phase === 'translating' || current.phase === 'ready' || current.phase === 'active')) {
      return this.activateCurrent(current)
    }
    if (this.preparing) return Promise.resolve('unavailable')
    const next = this.triggerQueue.catch(() => 'unavailable' as const).then(() => this.triggerOnce())
    this.triggerQueue = next
    return next
  }

  private async triggerOnce(): Promise<'started' | 'cancelled' | 'activated' | 'unavailable' | 'rejected'> {
    const current = this.live
    if (current && (current.phase === 'translating' || current.phase === 'ready' || current.phase === 'active')) {
      return this.activateCurrent(current)
    }

    // Profile/readiness/cancellation support is checked before content access.
    this.preparing = true
    let prepared: HudTranslationPreparedRun | null
    try { prepared = await this.dependencies.prepare() }
    finally { this.preparing = false }
    if (!prepared) return 'unavailable'

    await this.cancel()
    const controller = new AbortController()
    const session: LiveSession = {
      id: this.dependencies.randomId(), revision: 1, phase: 'translating', controller,
      output: '', copyFailed: false, complete: false, expiresAt: this.dependencies.now() + this.ttlMs,
      copying: false, activating: false, delivery: Promise.resolve(),
    }
    this.live = session
    session.timer = this.dependencies.schedule(() => { void this.expire(session) }, this.ttlMs)

    let input: string
    try {
      input = await this.dependencies.readClipboard(controller.signal)
    } catch {
      if (this.isCurrent(session)) await this.fail(session)
      return 'rejected'
    }
    if (!this.isCurrent(session) || controller.signal.aborted) return 'cancelled'
    let rejected = this.expired(session) || !input.trim() || Array.from(input).length > this.maxInputCharacters || input.includes('\0')
    try { rejected ||= this.dependencies.isSensitive(input) } catch { rejected = true }
    if (rejected) {
      await this.reject(session)
      return 'rejected'
    }

    if (!await this.publish(session)) { await this.retire(session); return 'unavailable' }
    if (!this.isCurrent(session) || controller.signal.aborted) return 'cancelled'
    if (this.expired(session)) { await this.expire(session); return 'cancelled' }
    void this.run(session, input, prepared)
    return 'started'
  }

  async copyAndClose(expected?: { sessionId: string; revision: number }): Promise<boolean> {
    const session = this.live
    if (!session || session.phase !== 'active' || !session.complete || !session.output || session.copying) return false
    if (expected && (session.id !== expected.sessionId || session.revision !== expected.revision)) return false
    if (this.expired(session)) { await this.expire(session); return false }
    const revision = session.revision
    session.copying = true
    try {
      await this.dependencies.writeClipboard(session.output, session.controller.signal)
      if (!this.isCurrent(session) || session.revision !== revision) return false
      await this.finish(session)
      return true
    } catch {
      if (this.isCurrent(session)) {
        if (this.expired(session)) { await this.expire(session); return false }
        session.copyFailed = true
        session.revision += 1
        await this.publish(session)
      }
      return false
    } finally {
      session.copying = false
    }
  }

  async cancelExpected(expected: { sessionId: string; revision: number }): Promise<boolean> {
    const session = this.live
    if (!session || session.id !== expected.sessionId || expected.revision > session.revision) return false
    await this.cancel()
    return true
  }

  private async activateCurrent(session: LiveSession): Promise<'activated' | 'unavailable'> {
    if (!this.isCurrent(session)) return 'unavailable'
    if (this.expired(session)) { await this.expire(session); return 'unavailable' }
    if (session.phase === 'active') return 'activated'
    if (session.activating) return 'unavailable'
    session.activating = true
    try {
      const activated = await this.dependencies.activate(this.view(session)).catch(() => false)
      if (!this.isCurrent(session) || session.controller.signal.aborted) return 'unavailable'
      if (this.expired(session)) { await this.expire(session); return 'unavailable' }
      if (!activated) return 'unavailable'
      session.phase = 'active'
      session.revision += 1
      await this.publish(session)
      return 'activated'
    } finally {
      session.activating = false
    }
  }

  async cancel(phase?: 'cancelled'): Promise<void> {
    const session = this.live
    if (!session) return
    if (phase) {
      this.live = null
      session.controller.abort()
      if (session.timer) this.dependencies.clearSchedule(session.timer)
      session.phase = phase
      session.output = ''
      session.revision += 1
      await this.publish(session)
    } else {
      await this.retire(session)
    }
  }

  private async run(session: LiveSession, input: string, prepared: HudTranslationPreparedRun): Promise<void> {
    try {
      const output = await prepared.translate(input, {
        signal: session.controller.signal,
        onText: (text) => {
          if (!this.isCurrent(session) || session.controller.signal.aborted || this.expired(session)) return
          session.output = text
          session.revision += 1
          void this.publish(session)
        },
      })
      if (!this.isCurrent(session) || session.controller.signal.aborted) return
      if (this.expired(session)) { await this.expire(session); return }
      if (!output.trim()) { await this.fail(session); return }
      session.output = output
      session.complete = true
      if (session.phase !== 'active') session.phase = 'ready'
      session.revision += 1
      await this.publish(session)
    } catch {
      if (!this.isCurrent(session) || session.controller.signal.aborted) return
      if (this.expired(session)) { await this.expire(session); return }
      await this.fail(session)
    }
  }

  private view(session: LiveSession): HudTranslationView {
    const { preview, truncated } = boundedPreview(session.output, this.previewCharacters)
    return { sessionId: session.id, revision: session.revision, phase: session.phase, preview, truncated, copyFailed: session.copyFailed, complete: session.complete, expiresAt: session.expiresAt }
  }

  private isCurrent(session: LiveSession): boolean { return this.live === session }
  private expired(session: LiveSession): boolean { return session.expiresAt <= this.dependencies.now() }

  private publish(session: LiveSession): Promise<boolean> {
    const view = this.view(session)
    let delivered = false
    nativeDelivery = nativeDelivery.then(async () => {
      try { await this.dependencies.present(view); delivered = true } catch { delivered = false }
    })
    session.delivery = nativeDelivery
    return session.delivery.then(() => delivered)
  }

  private retire(session: LiveSession): Promise<void> {
    if (!this.isCurrent(session)) return session.delivery
    this.live = null
    session.controller.abort()
    session.output = ''
    session.revision += 1
    if (session.timer) this.dependencies.clearSchedule(session.timer)
    const { id, revision } = session
    nativeDelivery = nativeDelivery.then(() => this.dependencies.dismiss(id, revision)).catch(() => undefined)
    session.delivery = nativeDelivery
    return session.delivery
  }

  private async reject(session: LiveSession): Promise<void> {
    if (!this.isCurrent(session)) return
    await this.retire(session)
  }

  private async fail(session: LiveSession): Promise<void> {
    if (!this.isCurrent(session)) return
    session.phase = 'error'
    session.output = ''
    session.revision += 1
    await this.publish(session)
  }

  private async finish(session: LiveSession): Promise<void> {
    if (!this.isCurrent(session)) return
    await this.retire(session)
  }

  private async expire(session: LiveSession): Promise<void> {
    if (!this.isCurrent(session)) return
    await this.retire(session)
  }
}
