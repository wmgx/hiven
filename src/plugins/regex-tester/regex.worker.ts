import { evaluateRegex } from './regexCore'
import type { RegexWorkerRequest, RegexWorkerResponse } from './regexExecution'

self.onmessage = (event: MessageEvent<RegexWorkerRequest>) => {
  const { requestId, pattern, flags, sourceText } = event.data
  // Compilation and every regex.exec call stay off the renderer thread.
  const result = evaluateRegex(pattern, flags, sourceText)
  self.postMessage({ requestId, result } satisfies RegexWorkerResponse)
}
