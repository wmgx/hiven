import type { AiPreflightReason, PluginAiApi } from '@hiven/plugin'
import { AI_CANDIDATE_LIMITS, candidatePrompt, parseCandidate, validCandidateInput, type CandidateInput, type RegexCandidate } from './aiCandidate'
import { createRegexExecution } from './regexExecution'

export type CandidateValidation = { kind: 'positive' | 'negative'; index: number; passed: boolean }
export type CandidateFailure = 'blocked' | 'limits' | 'model' | 'response' | 'timeout' | 'invalid' | 'validation' | 'changed'
export type AiCandidateState = {
  status: 'idle' | 'checking' | 'generating' | 'validating' | 'ready' | 'failed' | 'cancelled'
  candidate?: RegexCandidate
  validation?: CandidateValidation[]
  reason?: CandidateFailure
  preflightReason?: AiPreflightReason
}

/** One explicitly requested candidate, bound to the editor and provider selection.
 * No editor mutation occurs here; adopt is the only release of a usable candidate. */
export function createAiCandidateSession(
  ai: PluginAiApi,
  onState: (state: AiCandidateState) => void,
  options: { execution?: ReturnType<typeof createRegexExecution>; generationMs?: number } = {},
) {
  const execution = options.execution ?? createRegexExecution()
  let state: AiCandidateState = { status: 'idle' }
  let revision = 0
  let disposed = false
  let active: { controller: AbortController; runId?: string; finish: () => void } | undefined
  const publish = (next: AiCandidateState) => {
    state = next
    if (!disposed) onState(next)
  }
  const cancelRun = (runId: string) => { void ai.cancel(runId).catch(() => {}) }
  const stop = () => {
    revision++
    const pending = active
    active = undefined
    if (pending) {
      pending.controller.abort()
      if (pending.runId) cancelRun(pending.runId)
      pending.finish()
    }
    execution.cancel()
  }
  const invalidate = () => { stop(); publish({ status: 'idle' }) }
  const unsubscribe = ai.subscribePreflight?.(() => {
    const hadCandidate = state.status !== 'idle' && state.status !== 'cancelled'
    stop()
    if (hadCandidate) publish({ status: 'failed', reason: 'changed' })
  })

  const generate = async (raw: CandidateInput): Promise<void> => {
    stop()
    if (disposed) return
    if (!validCandidateInput(raw)) { publish({ status: 'failed', reason: 'limits' }); return }
    const input: CandidateInput = { description: raw.description, positiveExamples: [...raw.positiveExamples], negativeExamples: [...raw.negativeExamples] }
    const identity = revision
    const current = () => !disposed && revision === identity
    const controller = new AbortController()
    let release!: () => void
    const stopped = new Promise<void>((resolve) => { release = resolve })
    const pending = { controller, finish: release, runId: undefined as string | undefined }
    active = pending
    const fail = (reason: CandidateFailure, extra: Partial<AiCandidateState> = {}) => {
      if (current()) { stop(); publish({ ...extra, status: 'failed', reason }) }
    }
    const timer = setTimeout(() => fail('timeout'), options.generationMs ?? AI_CANDIDATE_LIMITS.generationMs)
    publish({ status: 'checking' })
    const work = async () => {
      try {
        const selection = await ai.preflight?.({ capabilities: ['text.generate'], inputModalities: ['text'] })
        if (!current()) return
        if (selection?.status !== 'ready' || !selection.providerId || !selection.agentId) {
          fail('blocked', { preflightReason: selection?.reason }); return
        }
        publish({ status: 'generating' })
        let output = ''
        let completed = false
        let started = false
        for await (const event of ai.stream({
          providerId: selection.providerId, agentId: selection.agentId,
          effort: selection.effort, capabilities: ['text.generate'], signal: controller.signal,
          input: [{ type: 'text', text: candidatePrompt(input) }],
        })) {
          if (!current()) {
            if (event.type === 'run.started') cancelRun(event.runId)
            return
          }
          if (event.type === 'run.started') {
            pending.runId = event.runId
            if (started || event.providerId !== selection.providerId || event.agentId !== selection.agentId) { fail('changed'); return }
            started = true
          } else if (!started || event.runId !== pending.runId) { fail('model'); return }
          if (event.type === 'text.delta') {
            output += event.delta
            if (output.length > AI_CANDIDATE_LIMITS.response) { fail('response'); return }
          }
          if (event.type === 'error') { fail('model'); return }
          if (event.type === 'completed') {
            if (event.status !== 'completed') { fail('model'); return }
            completed = true
            break
          }
        }
        if (!current()) return
        if (!completed) { fail('response'); return }
        clearTimeout(timer)
        pending.runId = undefined
        const candidate = parseCandidate(output)
        if (!candidate) { fail('response'); return }
        publish({ status: 'validating' })
        // Even when examples are omitted, compilation is isolated and bounded.
        const compiled = await execution.run({ ...candidate, sourceText: '' })
        if (!current()) return
        if (compiled.status !== 'ready') { fail(compiled.status === 'timeout' ? 'timeout' : 'invalid'); return }
        const validation: CandidateValidation[] = []
        for (const kind of ['positive', 'negative'] as const) {
          const examples = kind === 'positive' ? input.positiveExamples : input.negativeExamples
          for (const [index, sourceText] of examples.entries()) {
            const result = await execution.run({ ...candidate, sourceText })
            if (!current()) return
            if (result.status !== 'ready') { fail(result.status === 'timeout' ? 'timeout' : 'invalid'); return }
            validation.push({ kind, index, passed: kind === 'positive' ? result.matches.length > 0 : result.matches.length === 0 })
          }
        }
        if (!current()) return
        active = undefined
        if (validation.some((item) => !item.passed)) publish({ status: 'failed', reason: 'validation', candidate, validation })
        else publish({ status: 'ready', candidate, validation })
      } catch {
        fail('model')
      } finally {
        clearTimeout(timer)
        if (active === pending) active = undefined
      }
    }
    await Promise.race([work(), stopped])
    // A provider may ignore abort; the identity guard also rejects its late events.
    if (!current()) clearTimeout(timer)
  }

  return {
    generate,
    invalidate,
    cancel: () => { stop(); publish({ status: 'cancelled' }) },
    adopt: (): RegexCandidate | null => {
      if (disposed || state.status !== 'ready' || !state.candidate) return null
      const candidate = { ...state.candidate }
      invalidate()
      return candidate
    },
    dispose: () => { disposed = true; stop(); unsubscribe?.() },
  }
}
