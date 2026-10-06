import { invoke } from '@tauri-apps/api/core'

export type JevSettings = {
  enabled: boolean
  endpoint: string
  apiKey: string
  model: string
}

export type JevCandidate = { id: string; description: string }
export type JevSuggestion = { id: string; useInput: boolean }

export const JEV_PRESETS = {
  tencent: { endpoint: 'https://ai-gateway.edgeone.link/v1/systemone', model: '@makers/jev' },
  official: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
} as const

export function validJevEndpoint(value: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash || url.search) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function validJevSettings(settings: JevSettings | undefined): settings is JevSettings {
  return Boolean(settings && validJevEndpoint(settings.endpoint) &&
    typeof settings.apiKey === 'string' && settings.apiKey.trim() &&
    typeof settings.model === 'string' && settings.model.trim())
}

type JevResponse = { status: number; body: string }
type JevSend = (settings: JevSettings, body: string) => Promise<JevResponse>

async function sendJev(settings: JevSettings, body: string): Promise<JevResponse> {
  const request = {
    url: settings.endpoint,
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    body,
    timeoutMs: 8000,
  }
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return invoke<JevResponse>('plugin_http_request', { request })
  }
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body,
    signal: AbortSignal.timeout(request.timeoutMs),
  })
  return { status: response.status, body: await response.text() }
}

export class JevRequestError extends Error {
  readonly status: number
  constructor(status: number) {
    super('Jev request failed')
    this.status = status
  }
}

async function requestJevAnswer(settings: JevSettings, body: string, send: JevSend) {
  const response = await send(settings, body)
  if (response.status < 200 || response.status >= 300) throw new JevRequestError(response.status)
  let result: unknown
  try { result = JSON.parse(response.body) } catch { throw new JevRequestError(0) }
  const answers = (result as { answers?: Record<string, { type?: unknown; choice?: unknown; confidence?: unknown }> })?.answers
  const answer = answers?.action
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string' ||
    typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) ||
    answer.confidence < 0 || answer.confidence > 1) throw new JevRequestError(0)
  const inputMode = answers?.input_mode
  const useInput = inputMode?.type === 'choice' && inputMode.choice === 'content' &&
    typeof inputMode.confidence === 'number' && Number.isFinite(inputMode.confidence) &&
    inputMode.confidence >= 0.7 && inputMode.confidence <= 1
  return { choice: answer.choice, confidence: answer.confidence, useInput }
}

/** Returns only an ID from the current allowlist. The provider response never becomes executable content. */
export async function chooseJevCandidate(
  settings: JevSettings,
  query: string,
  candidates: readonly JevCandidate[],
  send: JevSend = sendJev,
): Promise<JevSuggestion | null> {
  if (!validJevSettings(settings) || candidates.length === 0) return null
  if (query.trim().length < 2 || query.length > 500) return null
  // ponytail: Choice has 255 options; shortlist locally if the live command catalog exceeds 254.
  const offered = candidates.slice(0, 254)
  const criteria = Object.fromEntries([
    ...offered.map((candidate, index) => [`c${index}`, candidate.description.slice(0, 240)]),
    ['none', 'No suitable command / 没有合适的命令'],
  ])
  const body = JSON.stringify({
    model: settings.model,
    state: query,
    questions: {
      action: {
        type: 'choice',
        instructions: 'The input may be a command request or raw content. Select the command that best fulfills the request or processes the content (for example, decode encoded text or format JSON). Choose none if no command fits. / 输入可能是操作描述，也可能是待处理内容。选择最符合请求或最适合处理该内容的命令，如解码编码文本、格式化 JSON；没有合适命令则选 none。',
        criteria,
      },
      input_mode: {
        type: 'choice',
        instructions: 'Can the entire input be passed unchanged as the text argument of a content-processing command? / 整段输入是否适合原样作为文本处理命令的输入参数？',
        criteria: {
          content: 'Raw content to process, such as JSON, code, encoded text, a timestamp, or prose. Preserve it verbatim. / 输入本身是待处理的 JSON、代码、编码文本、时间戳或正文，可原样作为参数。',
          intent: 'A command name or description of what to do, including instructions mixed with data. Do not use the entire request as a text argument. / 命令名、操作描述，或指令和数据混在一起；不应将整段请求当作参数。',
        },
      },
    },
  })
  const { choice, confidence, useInput } = await requestJevAnswer(settings, body, send)
  if (choice === 'none' || confidence < 0.5) return null
  const index = Number(choice.slice(1))
  if (!/^c(?:0|[1-9]\d*)$/.test(choice) || !Number.isInteger(index)) return null
  const candidate = offered[index]
  return candidate ? { id: candidate.id, useInput } : null
}

export async function testJevConnection(settings: JevSettings): Promise<void> {
  if (!validJevSettings(settings)) throw new JevRequestError(0)
  const body = JSON.stringify({
    model: settings.model,
    state: 'Connection test',
    questions: { action: { type: 'choice', instructions: 'Choose test.', criteria: { test: 'Connection test', none: 'No answer' } } },
  })
  const { choice } = await requestJevAnswer(settings, body, sendJev)
  if (choice !== 'test' && choice !== 'none') throw new JevRequestError(0)
}
