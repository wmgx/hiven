export type CurlError = 'empty' | 'limit' | 'quote' | 'shell' | 'command' | 'option' | 'value' | 'file' | 'url' | 'multiple' | 'header' | 'method' | 'conflict' | 'glob'
export class CurlParseError extends Error {
  readonly code: CurlError
  /** The offending token (option, header, URL...) when one is known. */
  readonly detail?: string
  constructor(code: CurlError, detail?: string) { super(code); this.code = code; this.detail = detail }
}
function fail(code: CurlError, detail?: string): never { throw new CurlParseError(code, detail) }
export type CurlRequest = { url: string; method: string; headers: Array<{ name: string; value: string }>; body: string | null }
export function curlHeaderDisplayLabels(headers: ReadonlyArray<{ name: string }>): string[] {
  const totals = new Map<string, number>()
  for (const header of headers) {
    const identity = header.name.toLowerCase()
    totals.set(identity, (totals.get(identity) ?? 0) + 1)
  }
  const occurrences = new Map<string, number>()
  return headers.map((header) => {
    const identity = header.name.toLowerCase()
    const occurrence = (occurrences.get(identity) ?? 0) + 1
    occurrences.set(identity, occurrence)
    return (totals.get(identity) ?? 0) > 1 ? `${header.name} (${occurrence})` : header.name
  })
}
const ANSI_C_SIMPLE: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b', '\\': '\\', "'": "'", '"': '"', '?': '?' }

/** Decodes a bash `$'...'` body starting after the opening quote; returns the text and the index of the closing quote. */
function readAnsiCQuoted(source: string, start: number): { text: string; end: number } {
  let text = ''
  for (let i = start; i < source.length; i++) {
    const char = source[i]!
    if (char === "'") return { text, end: i }
    if (char !== '\\') { text += char; continue }
    const next = source[++i]
    if (next === undefined) break
    if (next in ANSI_C_SIMPLE) { text += ANSI_C_SIMPLE[next]; continue }
    const hexLen = next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0
    if (hexLen) {
      const digits = /^[0-9a-fA-F]+/.exec(source.slice(i + 1, i + 1 + hexLen))?.[0] ?? ''
      if (!digits) { text += '\\' + next; continue }
      const code = parseInt(digits, 16)
      text += next === 'x' ? String.fromCharCode(code) : String.fromCodePoint(code > 0x10ffff ? 0xfffd : code)
      i += digits.length
      continue
    }
    if (/[0-7]/.test(next)) {
      const digits = /^[0-7]{1,3}/.exec(source.slice(i))![0]
      text += String.fromCharCode(parseInt(digits, 8))
      i += digits.length - 1
      continue
    }
    text += '\\' + next
  }
  fail('quote')
}

/** POSIX quoting (plus bash `$'...'`) only, lexical parsing; no shell, substitutions, globbing or file access. */
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
    if (char === '$' && !quote && source[i + 1] === "'") {
      const decoded = readAnsiCQuoted(source, i + 2)
      if (decoded.text.includes('\0')) fail('shell')
      word += decoded.text; started = true; i = decoded.end
      continue
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
const PLAIN_FLAGS = new Set(['--compressed', '-L', '--location', '-s', '--silent', '-S', '--show-error', '-k', '--insecure', '-v', '--verbose', '-i', '--include', '-f', '--fail', '--http1.1', '--http2'])
const PLAIN_SHORT = new Set(['L', 's', 'S', 'k', 'v', 'i', 'f'])
const IGNORED_VALUE_FLAGS = new Set(['-m', '--max-time', '--connect-timeout'])
const VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-ascii', '--data-binary', '--data-urlencode',
  '-b', '--cookie', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-F', '--form', '--json', '--url',
  ...IGNORED_VALUE_FLAGS,
])

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function basicAuth(user: string): string {
  const bytes = new TextEncoder().encode(user.includes(':') ? user : `${user}:`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function dataUrlencode(value: string, flag: string): string {
  const at = value.search(/[=@]/)
  if (at !== -1 && value[at] === '@') fail('file', flag)
  if (at === -1) return percentEncode(value)
  const name = value.slice(0, at)
  const content = percentEncode(value.slice(at + 1))
  return name ? `${name}=${content}` : content
}

export function parseCurl(source: string): CurlRequest {
  if (source.length > 100000) fail('limit')
  const words = tokenizeCurl(source.trim())
  if (!words.length) fail('empty')
  if (words.shift() !== 'curl') fail('command')
  const headers: CurlRequest['headers'] = [], data: string[] = [], form: string[] = [], cookies: string[] = []
  let url: string | undefined, method: string | undefined, head = false, end = false, json = false
  const setUrl = (value: string) => { if (url !== undefined) fail('multiple'); url = value }
  const addHeader = (name: string, value: string) => { headers.push({ name, value }) }
  for (let i = 0; i < words.length; i++) {
    const token = words[i]!
    if (!end && token === '--') { end = true; continue }
    if (end || !token.startsWith('-') || token === '-') { setUrl(token); continue }
    if (token === '-I' || token === '--head') { head = true; continue }
    if (PLAIN_FLAGS.has(token)) continue
    if (/^-[A-Za-z]{2,}$/.test(token) && [...token.slice(1)].every((c) => PLAIN_SHORT.has(c))) continue
    let flag = token, attached: string | undefined
    if (token.startsWith('--') && token.includes('=')) { const at = token.indexOf('='); flag = token.slice(0, at); attached = token.slice(at + 1) }
    else if (/^-[XHdbuAeF].+/.test(token)) { flag = token.slice(0, 2); attached = token.slice(2) }
    if (!VALUE_FLAGS.has(flag)) fail('option', flag)
    const value = attached ?? words[++i]
    if (value === undefined) fail('value', flag)
    if (IGNORED_VALUE_FLAGS.has(flag)) continue
    if (flag === '--url') setUrl(value)
    else if (flag === '-X' || flag === '--request') {
      if (!/^[A-Za-z]+$/.test(value)) fail('method', value)
      if (method !== undefined) fail('conflict')
      method = value // curl preserves explicit method case.
    } else if (flag === '-H' || flag === '--header') {
      if (value.startsWith('@')) fail('file', value)
      const at = value.indexOf(':')
      if (at < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.slice(0, at)) || /[\r\n]/.test(value)) fail('header', value)
      const headerValue = value.slice(at + 1).trimStart()
      // Empty header syntax removes curl-generated headers; do not misrepresent as a sent empty field.
      if (!headerValue) fail('header', value)
      addHeader(value.slice(0, at), headerValue)
    } else if (flag === '-b' || flag === '--cookie') {
      if (!value.includes('=')) fail('file', `${flag} ${value}`)
      cookies.push(value)
    } else if (flag === '-u' || flag === '--user') addHeader('Authorization', basicAuth(value))
    else if (flag === '-A' || flag === '--user-agent') addHeader('User-Agent', value)
    else if (flag === '-e' || flag === '--referer') addHeader('Referer', value)
    else if (flag === '-F' || flag === '--form') {
      const eq = value.indexOf('=')
      if (eq < 1 || /^[@<]/.test(value.slice(eq + 1))) fail('file', `${flag} ${value}`)
      form.push(value.replace(/;type=[^;]*$/, ''))
    } else if (flag === '--json') {
      if (value.startsWith('@')) fail('file', `${flag} ${value}`)
      json = true; data.push(value)
    } else if (flag === '--data-urlencode') data.push(dataUrlencode(value, flag))
    else {
      if (flag !== '--data-raw' && value.startsWith('@')) fail('file', `${flag} ${value}`)
      data.push(value)
    }
  }
  if (cookies.length) addHeader('Cookie', cookies.join('; '))
  if (!url || url.startsWith('@') || /[\s\u0000-\u001f\u007f]/.test(url)) fail('url', url)
  // Browsers' "Copy as cURL" always includes a scheme; hand-typed commands often don't (curl defaults to http).
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) url = `http://${url.replace(/^\/\//, '')}`
  try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) fail('url', url) } catch (error) { if (error instanceof CurlParseError) throw error; fail('url', url) }
  // Locate the raw authority before /, ? or #; slashes inside query values
  // must never hide a curl glob. Only a validated IPv6 host's brackets are exempt.
  if (!/^https?:\/\//i.test(url)) fail('url', url)
  const authorityStart = url.indexOf('://') + 3
  const authority = url.slice(authorityStart).split(/[/?#]/, 1)[0]!
  const hostStart = authorityStart + authority.lastIndexOf('@') + 1
  let literalUrl = url
  if (url[hostStart] === '[') {
    const close = url.indexOf(']', hostStart)
    literalUrl = url.slice(0, hostStart) + url.slice(hostStart + 1, close) + url.slice(close + 1)
  }
  if (/[{}\[\]]/.test(literalUrl)) fail('glob', url)
  if (head && (data.length || form.length || method !== undefined)) fail('conflict')
  if (form.length && data.length) fail('conflict')
  const hasHeader = (name: string) => headers.some((h) => h.name.toLowerCase() === name)
  if (json) {
    if (!hasHeader('content-type')) addHeader('Content-Type', 'application/json')
    if (!hasHeader('accept')) addHeader('Accept', 'application/json')
  } else if (data.length && !hasHeader('content-type')) addHeader('Content-Type', 'application/x-www-form-urlencoded')
  const body = form.length ? form.join('\n') : data.length ? data.join(json ? '' : '&') : null
  return { url, method: method ?? (head ? 'HEAD' : body !== null ? 'POST' : 'GET'), headers, body }
}
