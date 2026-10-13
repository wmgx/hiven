import type { PluginSurfaceHostApi } from '@hiven/plugin'
import type { QrDecodeResult } from './qrCore'

type Result = Extract<QrDecodeResult, { ok: true }>
export type QrHandoffState = { result: Result | null; status: 'idle' | 'pending' | 'failed' | 'accepted' }
export const EMPTY_QR_HANDOFF: QrHandoffState = { result: null, status: 'idle' }

/** One explicit delivery of the current scan; no clipboard or extra navigation. */
export function createQrResultHandoff(publish: (state: QrHandoffState) => void) {
  let state = EMPTY_QR_HANDOFF
  let active = false
  let pending: AbortController | undefined
  const update = (next: QrHandoffState) => { state = next; publish(state) }
  const interrupt = () => {
    pending?.abort()
    pending = undefined
    update({ result: state.result, status: 'idle' })
  }
  return {
    activate() { active = true },
    deactivate() { active = false; interrupt() },
    interrupt,
    setResult(result: Result | null) {
      // Even identical text from a new scan revokes the previous result's action.
      interrupt()
      update({ result, status: 'idle' })
    },
    async submit(expected: QrHandoffState, host: PluginSurfaceHostApi) {
      if (!active || expected !== state || pending || state.status === 'accepted' || !state.result?.text
        || host.deliveryFeedbackOwner?.isCurrent() === false) return
      const result = state.result
      const submission = new AbortController()
      pending = submission
      update({ result, status: 'pending' })
      const current = () => active && pending === submission && !submission.signal.aborted
      try {
        const accepted = await host.returnToLauncherWithObject(
          { kind: 'text', text: result.text, source: 'tool-result' },
          { signal: submission.signal },
        )
        if (current()) update({ result, status: accepted === false ? 'failed' : 'accepted' })
      } catch {
        if (current()) update({ result, status: 'failed' })
      } finally {
        if (pending === submission) pending = undefined
      }
    },
  }
}
