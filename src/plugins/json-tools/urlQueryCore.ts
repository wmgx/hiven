/** Local HTTP(S) query editing; URL validation never serializes or visits the input. */
export const URL_QUERY_MAX_CHARS = 262_144
export const URL_QUERY_MAX_ROWS = 1000
export type UrlQueryErrorCode = 'urlRequired' | 'urlTooLarge' | 'urlTooManyParameters' | 'urlInvalidText'
export class UrlQueryError extends Error {
  readonly code: UrlQueryErrorCode
  constructor(code: UrlQueryErrorCode) { super(code); this.code = code }
}
export type UrlParameter = { raw: string; rawKey: string; rawValue: string; key: string; value: string; hasEquals: boolean; validEncoding: boolean }
export type ParsedUrlQuery = { base: string; fragment: string; hasQuery: boolean; parameters: UrlParameter[] }
function decode(raw: string): { value: string; valid: boolean } {
  try { return { value: decodeURIComponent(raw.replace(/\+/g, ' ')), valid: true } }
  catch { return { value: raw, valid: false } }
}
function encode(value: string): string {
  try { return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) }
  catch { throw new UrlQueryError('urlInvalidText') }
}
export function parseUrlQuery(input: string): ParsedUrlQuery {
  if (input.length > URL_QUERY_MAX_CHARS) throw new UrlQueryError('urlTooLarge')
  if (!/^https?:\/\//i.test(input) || /\s/.test(input) || /[\u0000-\u001f\u007f]/.test(input)) throw new UrlQueryError('urlRequired')
  try {
    const url = new URL(input)
    if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch { throw new UrlQueryError('urlRequired') }
  const hashIndex = input.indexOf('#')
  const fragment = hashIndex < 0 ? '' : input.slice(hashIndex)
  const beforeHash = hashIndex < 0 ? input : input.slice(0, hashIndex)
  const queryIndex = beforeHash.indexOf('?')
  const base = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex)
  const query = queryIndex < 0 ? '' : beforeHash.slice(queryIndex + 1)
  const rawParameters = query ? query.split('&') : []
  if (rawParameters.length > URL_QUERY_MAX_ROWS) throw new UrlQueryError('urlTooManyParameters')
  const parameters = rawParameters.map((raw) => {
    const equals = raw.indexOf('=')
    const rawKey = equals < 0 ? raw : raw.slice(0, equals)
    const rawValue = equals < 0 ? '' : raw.slice(equals + 1)
    const key = decode(rawKey); const value = decode(rawValue)
    return { raw, rawKey, rawValue, key: key.value, value: value.value, hasEquals: equals >= 0, validEncoding: key.valid && value.valid }
  })
  return { base, fragment, hasQuery: queryIndex >= 0, parameters }
}
export function serializeUrlQuery(parsed: ParsedUrlQuery, raws = parsed.parameters.map((parameter) => parameter.raw)): string {
  return `${parsed.base}${parsed.hasQuery || raws.length ? `?${raws.join('&')}` : ''}${parsed.fragment}`
}
export function editUrlParameter(input: string, index: number, field: 'key' | 'value', text: string): string {
  const parsed = parseUrlQuery(input)
  const parameter = parsed.parameters[index]
  if (!parameter) throw new RangeError('Invalid parameter index')
  if (parameter[field] === text) return input
  const key = field === 'key' ? encode(text) : parameter.rawKey
  const value = field === 'value' ? encode(text) : parameter.rawValue
  const raw = `${key}${parameter.hasEquals || field === 'value' ? `=${value}` : ''}`
  const raws = parsed.parameters.map((item, row) => row === index ? raw : item.raw)
  const output = serializeUrlQuery(parsed, raws)
  parseUrlQuery(output) // Enforce the same complete-result size bound after encoding.
  return output
}
export function addUrlParameter(input: string): string {
  const parsed = parseUrlQuery(input)
  const output = serializeUrlQuery(parsed, [...parsed.parameters.map((parameter) => parameter.raw), '='])
  parseUrlQuery(output)
  return output
}
export function removeUrlParameter(input: string, index: number): string {
  const parsed = parseUrlQuery(input)
  if (!parsed.parameters[index]) throw new RangeError('Invalid parameter index')
  return serializeUrlQuery(parsed, parsed.parameters.filter((_, row) => row !== index).map((parameter) => parameter.raw))
}
