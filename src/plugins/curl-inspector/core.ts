export type CurlError = 'empty' | 'limit' | 'quote' | 'shell' | 'command' | 'option' | 'value' | 'file' | 'url' | 'multiple' | 'header' | 'method' | 'conflict' | 'glob'
export class CurlParseError extends Error {
  readonly code: CurlError
  constructor(code: CurlError) { super(code); this.code = code }
}
function fail(code: CurlError): never { throw new CurlParseError(code) }
export type CurlRequest = { url: string; method: string; headers: Array<{ name: string; value: string }>; body: string | null }
/** POSIX quoting only, lexical parsing; no shell, substitutions, globbing or file access. */
export function tokenizeCurl(source: string): string[] {
  if (source.length > 100000) fail('limit')
  const result: string[] = []
  let word = '', started = false, quote = ''
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '\0') fail('shell')
    if (quote === "'") { if (char === "'") quote = ''; else word += char; continue }
    if (char === '\\') {
      const next = source[++i]
      if (next === undefined) fail('quote')
      if (next === '\n') continue
      if (next === '\r' && source[i + 1] === '\n') { i++; continue }
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) word += '\\'
      word += next; started = true; continue
    }
    if (char === '$' || char === '`') fail('shell')
    if (quote === '"') { if (char === '"') quote = ''; else word += char; continue }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (/[|;&<>#~*?{}\[\]()]/.test(char)) fail('shell')
    if (/\s/.test(char)) {
      if (started) { result.push(word); word = ''; started = false }
      // A non-continuation newline may start a second shell command: reject.
      if ((char === '\n' || char === '\r') && source.slice(i).trim()) fail('shell')
    } else { word += char; started = true }
  }
  if (quote) fail('quote')
  if (started) result.push(word)
  return result
}
export function parseCurl(source: string): CurlRequest {
  if (source.length > 100000) fail('limit')
  const words = tokenizeCurl(source.trim())
  if (!words.length) fail('empty')
  if (words.shift() !== 'curl') fail('command')
  const headers: CurlRequest['headers'] = [], data: string[] = []
  let url: string | undefined, method: string | undefined, head = false, end = false
  const setUrl = (value: string) => { if (url !== undefined) fail('multiple'); url = value }
  for (let i = 0; i < words.length; i++) {
    const token = words[i]
    if (!end && token === '--') { end = true; continue }
    if (end || !token.startsWith('-')) { setUrl(token); continue }
    if (token === '-I' || token === '--head') { head = true; continue }
    let flag = token, attached: string | undefined
    if (token.startsWith('--') && token.includes('=')) { const at = token.indexOf('='); flag = token.slice(0, at); attached = token.slice(at + 1) }
    else if (/^-[XHd].+/.test(token)) { flag = token.slice(0, 2); attached = token.slice(2) }
    if (!['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--url'].includes(flag)) fail('option')
    const value = attached ?? words[++i]
    if (value === undefined) fail('value')
    if (flag === '--url') setUrl(value)
    else if (flag === '-X' || flag === '--request') {
      if (!/^[A-Za-z]+$/.test(value)) fail('method')
      if (method !== undefined) fail('conflict')
      method = value // curl preserves explicit method case.
    } else if (flag === '-H' || flag === '--header') {
      if (value.startsWith('@')) fail('file')
      const at = value.indexOf(':')
      if (at < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.slice(0, at)) || /[\r\n]/.test(value)) fail('header')
      const headerValue = value.slice(at + 1).trimStart()
      // Empty header syntax removes curl-generated headers; do not misrepresent as a sent empty field.
      if (!headerValue) fail('header')
      headers.push({ name: value.slice(0, at), value: headerValue })
    } else {
      if (flag !== '--data-raw' && value.startsWith('@')) fail('file')
      data.push(value)
    }
  }
  if (!url || /[\s\u0000-\u001f\u007f]/.test(url)) fail('url')
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) fail('url') } catch { fail('url') }
  // Locate the raw authority before /, ? or #; slashes inside query values
  // must never hide a curl glob. Only a validated IPv6 host's brackets are exempt.
  if (!/^https?:\/\//i.test(url)) fail('url')
  const authorityStart = url.indexOf('://') + 3
  const authority = url.slice(authorityStart).split(/[/?#]/, 1)[0]
  const hostStart = authorityStart + authority.lastIndexOf('@') + 1
  let literalUrl = url
  if (url[hostStart] === '[') {
    const close = url.indexOf(']', hostStart)
    literalUrl = url.slice(0, hostStart) + url.slice(hostStart + 1, close) + url.slice(close + 1)
  }
  if (/[{}\[\]]/.test(literalUrl)) fail('glob')
  if (head && (data.length || method !== undefined)) fail('conflict')
  if (data.length && !headers.some((h) => h.name.toLowerCase() === 'content-type')) headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' })
  return { url, method: method ?? (head ? 'HEAD' : data.length ? 'POST' : 'GET'), headers, body: data.length ? data.join('&') : null }
}
