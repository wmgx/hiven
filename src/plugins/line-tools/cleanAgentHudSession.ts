export type CleanAgentHudFailure = 'unavailable' | 'no-change' | 'too-large' | 'refused'

export type CleanAgentHudView = {
  product: 'clean-agent'
  sessionId: string
  revision: number
  phase: 'translating' | 'ready' | 'active' | 'error'
  preview: string
  truncated: boolean
  copyFailed: boolean
  complete: boolean
  sensitive: boolean
  failure?: CleanAgentHudFailure
  expiresAt: number
}

export type CleanAgentHudDependencies = {
  read(signal: AbortSignal, isCurrent: () => boolean): Promise<string>
  clean(text: string): string
  isSensitive(text: string): boolean
  write(text: string, sensitive: boolean, signal: AbortSignal): Promise<void>
  present(view: CleanAgentHudView, fullText?: string): Promise<void> | void
  activate(view: CleanAgentHudView): Promise<number | null>
  dismiss(sessionId: string, revision: number): Promise<void> | void
  now(): number
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearSchedule(timer: ReturnType<typeof setTimeout>): void
  randomId(): string
}

type Live = {
  id: string; revision: number; phase: CleanAgentHudView['phase']; controller: AbortController
  output: string; sensitive: boolean; complete: boolean; copyFailed: boolean
  failure?: CleanAgentHudFailure; expiresAt: number; timer?: ReturnType<typeof setTimeout>
  activating: boolean; copying: boolean; delivery: Promise<void>
}

const PASSIVE_TTL_MS = 15_000
const ACTIVE_TTL_MS = 120_000
export const CLEAN_AGENT_MAX_INPUT_CHARS = 250_000
let nativeDelivery: Promise<void> = Promise.resolve()

export class CleanAgentHudSession {
  private live: Live | null = null
  private queue: Promise<'started' | 'activated' | 'cancelled'> = Promise.resolve('cancelled')
  private readonly dependencies: CleanAgentHudDependencies
  constructor(dependencies: CleanAgentHudDependencies) { this.dependencies = dependencies }

  trigger(): Promise<'started' | 'activated' | 'cancelled'> {
    const current = this.live
    if (current?.phase === 'ready' || current?.phase === 'active') return this.activateCurrent(current)
    if (current?.phase === 'translating') return Promise.resolve('cancelled')
    const next = this.queue.catch(() => 'cancelled' as const).then(() => this.start())
    this.queue = next
    return next
  }

  private async start(): Promise<'started' | 'cancelled'> {
    await this.cancel()
    const session: Live = { id: this.dependencies.randomId(), revision: 1, phase: 'translating',
      controller: new AbortController(), output: '', sensitive: false, complete: false, copyFailed: false,
      expiresAt: this.dependencies.now() + PASSIVE_TTL_MS, activating: false, copying: false, delivery: Promise.resolve() }
    this.live = session
    this.scheduleExpiry(session)
    if (!await this.publish(session)) { await this.retire(session); return 'cancelled' }
    try {
      const isCurrent = () => this.live === session && !session.controller.signal.aborted && !this.expired(session)
      const input = await this.dependencies.read(session.controller.signal, isCurrent)
      if (!isCurrent()) return 'cancelled'
      if (input.includes('\0') || Array.from(input).length > CLEAN_AGENT_MAX_INPUT_CHARS) {
        await this.fail(session, 'too-large'); return 'started'
      }
      if (this.dependencies.isSensitive(input)) { await this.fail(session, 'refused'); return 'started' }
      const output = this.dependencies.clean(input)
      if (!isCurrent()) return 'cancelled'
      if (!output || output === input) { await this.fail(session, 'no-change'); return 'started' }
      session.output = output
      session.sensitive = this.dependencies.isSensitive(output)
      session.complete = true
      session.phase = 'ready'
      session.revision += 1
      await this.publish(session)
      return 'started'
    } catch {
      if (this.live === session && !session.controller.signal.aborted) await this.fail(session, 'unavailable')
      return 'started'
    }
  }

  async copyAndClose(expected: { sessionId: string; revision: number }): Promise<boolean> {
    const session = this.live
    if (!session || session.phase !== 'active' || !session.complete || !session.output || session.copying
      || session.id !== expected.sessionId || session.revision !== expected.revision || this.expired(session)) return false
    session.copying = true
    try {
      await this.dependencies.write(session.output, session.sensitive, session.controller.signal)
      if (this.live !== session || session.controller.signal.aborted) return false
      await this.retire(session)
      return true
    } catch {
      if (this.live === session && !this.expired(session)) {
        session.copyFailed = true; session.revision += 1
        if (!await this.publish(session)) await this.retire(session)
      }
      return false
    } finally { session.copying = false }
  }

  async cancelExpected(expected: { sessionId: string; revision: number }): Promise<boolean> {
    const session = this.live
    if (!session || session.id !== expected.sessionId || expected.revision > session.revision) return false
    await this.cancel(); return true
  }
  async cancel(): Promise<void> { if (this.live) await this.retire(this.live) }

  private async activateCurrent(session: Live): Promise<'activated' | 'cancelled'> {
    if (this.live !== session || this.expired(session) || session.activating) return 'cancelled'
    if (session.phase === 'active') return 'activated'
    session.activating = true
    try {
      const deadline = await this.dependencies.activate(this.view(session)).catch(() => null)
      if (this.live !== session || session.controller.signal.aborted || !deadline
        || deadline <= this.dependencies.now() || deadline > this.dependencies.now() + ACTIVE_TTL_MS) return 'cancelled'
      session.expiresAt = deadline
      if (session.timer) this.dependencies.clearSchedule(session.timer)
      this.scheduleExpiry(session)
      session.phase = 'active'; session.revision += 1
      if (!await this.publish(session)) { await this.retire(session); return 'cancelled' }
      return 'activated'
    } finally { session.activating = false }
  }

  private view(session: Live): CleanAgentHudView {
    return { product: 'clean-agent', sessionId: session.id, revision: session.revision, phase: session.phase,
      preview: '', truncated: false, copyFailed: session.copyFailed, complete: session.complete,
      sensitive: session.sensitive, failure: session.failure, expiresAt: session.expiresAt }
  }
  private publish(session: Live): Promise<boolean> {
    const view = this.view(session)
    const fullText = view.phase === 'active' && view.complete ? session.output : undefined
    let delivered = false
    nativeDelivery = nativeDelivery.then(async () => {
      try { await this.dependencies.present(view, fullText); delivered = true } catch { delivered = false }
    })
    session.delivery = nativeDelivery
    return session.delivery.then(() => delivered)
  }
  private async fail(session: Live, failure: CleanAgentHudFailure) {
    if (this.live !== session) return
    session.phase = 'error'; session.failure = failure; session.output = ''; session.complete = false
    session.sensitive = false; session.revision += 1
    await this.publish(session)
  }
  private retire(session: Live): Promise<void> {
    if (this.live !== session) return session.delivery
    this.live = null; session.controller.abort(); session.output = ''; session.revision += 1
    if (session.timer) this.dependencies.clearSchedule(session.timer)
    nativeDelivery = nativeDelivery.then(() => this.dependencies.dismiss(session.id, session.revision)).catch(() => undefined)
    session.delivery = nativeDelivery
    return session.delivery
  }
  private expired(session: Live) { return session.expiresAt <= this.dependencies.now() }
  private scheduleExpiry(session: Live) {
    const deadline = session.expiresAt
    session.timer = this.dependencies.schedule(() => {
      if (this.live === session && session.expiresAt <= deadline && this.expired(session)) void this.retire(session)
    }, Math.max(0, deadline - this.dependencies.now()))
  }
}
