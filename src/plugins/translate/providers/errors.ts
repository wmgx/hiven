/**
 * Provider failures carry a code so the surface can show localized text; `detail` is the
 * provider's own message (for example a Baidu error_msg) and is only appended to the localized line.
 */
export type TranslateErrorCode = 'credentials' | 'http' | 'response' | 'empty'

export class TranslateError extends Error {
  readonly code: TranslateErrorCode
  readonly detail?: string

  constructor(code: TranslateErrorCode, detail?: string) {
    super(detail ?? code)
    this.name = 'TranslateError'
    this.code = code
    this.detail = detail
  }
}

/** Provider bodies that are not JSON (gateway pages, truncated replies) become a `response` error. */
export function parseProviderJson<T>(body: string, status: number): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw new TranslateError('response', String(status))
  }
}
