import InlineRegexWorker from './regex.worker?worker&inline'
import type { MatchResult } from './regexCore'

export type RegexExecutionInput = { pattern: string; flags: string; sourceText: string }
export type RegexExecutionOutcome = {
  status: 'ready' | 'invalid' | 'timeout' | 'failed' | 'cancelled'
  matches: MatchResult[]
  error: string | null
}
export type RegexWorkerRequest = RegexExecutionInput & { requestId: number }
export type RegexWorkerResponse = {
  requestId: number
  result: { error: string | null; matches: MatchResult[] }
}

export const REGEX_EXECUTION_TIMEOUT_MS = 1000

/** One disposable worker per evaluation, including compilation. Cancellation
 * terminates execution rather than leaving a timed-out RegExp running. */
export function createRegexExecution(options: {
  createWorker?: () => Worker
  timeoutMs?: number
} = {}) {
  let nextRequestId = 0
  let pending: { cancel: () => void } | null = null
  const createWorker = options.createWorker ?? (() => new InlineRegexWorker())
  const timeoutMs = options.timeoutMs ?? REGEX_EXECUTION_TIMEOUT_MS

  const cancel = () => pending?.cancel()

  const run = (input: RegexExecutionInput): Promise<RegexExecutionOutcome> => {
    cancel()
    const requestId = ++nextRequestId
    return new Promise((resolve) => {
      let worker: Worker | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const request = { cancel: () => finish('cancelled') }
      const finish = (
        status: RegexExecutionOutcome['status'],
        result: { error: string | null; matches: MatchResult[] } = { error: null, matches: [] },
      ) => {
        if (settled || pending !== request) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        if (worker) {
          worker.onmessage = null
          worker.onerror = null
          worker.onmessageerror = null
          worker.terminate()
        }
        pending = null
        resolve({ status, ...result })
      }
      pending = request
      timer = setTimeout(() => finish('timeout'), timeoutMs)
      try {
        worker = createWorker()
        worker.onmessage = (event: MessageEvent<RegexWorkerResponse>) => {
          if (settled || pending !== request || event.data?.requestId !== requestId) return
          const result = event.data.result
          if (!result || !Array.isArray(result.matches)
            || (result.error !== null && typeof result.error !== 'string')) {
            finish('failed')
            return
          }
          finish(result.error === null ? 'ready' : 'invalid', result)
        }
        worker.onerror = (event) => {
          event.preventDefault()
          finish('failed')
        }
        worker.onmessageerror = () => finish('failed')
        worker.postMessage({ ...input, requestId } satisfies RegexWorkerRequest)
      } catch {
        finish('failed')
      }
    })
  }

  return { run, cancel }
}
