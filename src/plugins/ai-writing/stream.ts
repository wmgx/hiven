import type { PluginAiApi } from '@hiven/plugin'
import { buildSummaryRequest, SummaryError, type SummaryPointLimit, type SummarySelection } from './prompt'

function aborted(): Error {
  const error = new Error('Summary cancelled')
  error.name = 'AbortError'
  return error
}

export async function streamSummary(ai: PluginAiApi, text: string, maxPoints: SummaryPointLimit, selection: SummarySelection, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  if (signal.aborted) throw aborted()
  const request = buildSummaryRequest(text, maxPoints, selection, signal)
  let output = ''
  let completed = false
  for await (const event of ai.stream(request)) {
    if (signal.aborted) throw aborted()
    if (event.type === 'run.started' && (event.providerId !== selection.providerId || event.agentId !== selection.agentId)) {
      throw new SummaryError('binding')
    }
    if (event.type === 'text.delta') {
      output += event.delta
      onText(output)
    }
    if (event.type === 'error') throw new SummaryError('provider', event.message)
    if (event.type === 'completed') {
      if (event.status === 'cancelled') throw aborted()
      completed = true
      break
    }
  }
  if (signal.aborted) throw aborted()
  if (!completed) throw new SummaryError('incomplete')
  if (!output.trim()) throw new SummaryError('empty')
  return output.trim()
}
