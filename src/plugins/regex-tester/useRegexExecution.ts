import { useLayoutEffect, useMemo, useState } from 'react'
import { createRegexExecution, type RegexExecutionOutcome } from './regexExecution'

type Owner = { isCurrent(): boolean; subscribeInvalidation(callback: () => void): () => void }
const pending = { status: 'running' as const, matches: [], error: null }

/** Render only the result for this exact input and host lifetime. */
export function useRegexExecution(pattern: string, flags: string, sourceText: string, owner?: Owner) {
  const [execution] = useState(() => createRegexExecution())
  const input = useMemo(() => ({ pattern, flags, sourceText }), [pattern, flags, sourceText])
  const [settled, setSettled] = useState<{ input: typeof input; owner?: Owner; result: RegexExecutionOutcome } | null>(null)
  useLayoutEffect(() => {
    let active = true
    const cancel = () => {
      execution.cancel()
      if (active) setSettled({ input, owner, result: { status: 'cancelled', matches: [], error: null } })
    }
    const stop = owner?.subscribeInvalidation(cancel)
    if (!owner || owner.isCurrent()) {
      void execution.run(input).then((result) => {
        if (active && (!owner || owner.isCurrent())) setSettled({ input, owner, result })
      })
    } else {
      setSettled({ input, owner, result: { status: 'cancelled', matches: [], error: null } })
    }
    return () => { active = false; stop?.(); execution.cancel() }
  }, [execution, input, owner])
  return {
    result: settled?.input === input && settled.owner === owner ? settled.result : pending,
    cancel: () => { execution.cancel(); setSettled({ input, owner, result: { status: 'cancelled', matches: [], error: null } }) },
  }
}
