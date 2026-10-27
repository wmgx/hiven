export type PathFormat = 'posix' | 'uri' | 'relative' | 'name' | 'markdown-image'
export type PathStyle = 'auto' | 'unix' | 'windows'
export type PathErrorCode = 'empty' | 'invalid' | 'absolute' | 'base' | 'root' | 'limit' | 'directory' | 'output-limit'
export const MARKDOWN_IMAGE_MAX_BYTES = 1024 * 1024
export class PathTransformError extends Error {
  readonly code: PathErrorCode
  constructor(code: PathErrorCode) { super(code); this.code = code }
}
type Parsed = { style: 'unix' | 'windows'; root: string; parts: string[]; absolute: boolean; trailing: boolean }
const fail = (code: PathErrorCode): never => { throw new PathTransformError(code) }

function parse(raw: string, style: PathStyle): Parsed {
  if (!raw || /[\0-\x1f\x7f]/.test(raw)) return fail('invalid')
  let input = raw
  if (/^file:/i.test(input)) {
    // Reject URI syntax that could silently discard a query/fragment or encoded separator.
    if (!/^file:\/\//i.test(input) || /[?#\\]/.test(input) || /%(?:2f|5c)/i.test(input)) return fail('invalid')
    let uri: URL
    try { uri = new URL(input) } catch { return fail('invalid') }
    if (uri.username || uri.password || uri.port) return fail('invalid')
    let path: string
    try { path = decodeURIComponent(uri.pathname) } catch { return fail('invalid') }
    if (/[\0-\x1f\x7f]/.test(path)) return fail('invalid')
    if (uri.hostname && uri.hostname !== 'localhost') {
      input = `//${uri.hostname}${path}`; style = 'windows'
    } else if (/^\/[a-z]:\//i.test(path)) {
      input = path.slice(1); style = 'windows'
    } else { input = path; style = 'unix' }
  }
  const windows = style === 'windows' || (style === 'auto' && (/^[a-z]:/i.test(input) || /^\\\\/.test(input)))
  if (!windows) return { style: 'unix', root: input.startsWith('/') ? '/' : '', parts: input.split('/').filter(Boolean), absolute: input.startsWith('/'), trailing: input.endsWith('/') }
  input = input.replace(/\\/g, '/')
  if (/^[a-z]:/i.test(input)) {
    if (!/^[a-z]:\//i.test(input)) return fail('absolute')
    return { style: 'windows', root: input.slice(0, 2), parts: input.slice(3).split('/').filter(Boolean), absolute: true, trailing: input.endsWith('/') }
  }
  if (input.startsWith('//')) {
    const [server, share, ...parts] = input.slice(2).split('/')
    if (!server || !share || server === '.' || server === '?' || share === '.' || share === '..' || /[:@%\s]/.test(server)) return fail('invalid')
    return { style: 'windows', root: `//${server}/${share}`, parts: parts.filter(Boolean), absolute: true, trailing: input.endsWith('/') }
  }
  // A drive-less rooted Windows path depends on process state; never guess its drive.
  if (input.startsWith('/')) return fail('absolute')
  return { style: 'windows', root: '', parts: input.split('/').filter(Boolean), absolute: false, trailing: input.endsWith('/') }
}
const encode = (part: string) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
function normalized(path: Parsed): string[] {
  const parts: string[] = []
  for (const part of path.parts) {
    if (part === '.') continue
    if (part === '..') { if (parts.length) parts.pop(); continue }
    parts.push(part)
  }
  return parts
}
function transformOne(raw: string, format: PathFormat, base: string, style: PathStyle): string {
  const path = parse(raw, style)
  if (format === 'name') return path.parts.at(-1) ?? (path.root.startsWith('//') ? path.root.split('/').at(-1)! : path.root)
  if (format === 'posix') {
    const prefix = path.root === '/' ? '/' : path.root ? `${path.root}/` : ''
    const result = prefix + path.parts.join('/')
    return result + (path.trailing && path.parts.length > 0 ? '/' : '')
  }
  if (!path.absolute) return fail('absolute')
  if (format === 'uri') {
    const suffix = path.parts.map(encode).join('/') + (path.trailing && path.parts.length ? '/' : '')
    if (path.root.startsWith('//')) {
      const [server, share] = path.root.slice(2).split('/')
      return `file://${server}/${encode(share)}/${suffix}`
    }
    return `file:///${path.root === '/' ? '' : `${path.root}/`}${suffix}`
  }
  if (!base) return fail('base')
  const from = parse(base, style)
  if (!from.absolute) return fail('base')
  const equal = (a: string, b: string) => path.style === 'windows' ? a.toLowerCase() === b.toLowerCase() : a === b
  if (path.style !== from.style || !equal(path.root, from.root)) return fail('root')
  const targetParts = normalized(path), baseParts = normalized(from)
  let shared = 0
  while (shared < targetParts.length && shared < baseParts.length && equal(targetParts[shared], baseParts[shared])) shared++
  const relative = [...baseParts.slice(shared).map(() => '..'), ...targetParts.slice(shared)]
  if (format === 'markdown-image') {
    // Only syntactically known directories are rejected; no existence or image
    // type is inferred. An ancestor of the explicit base is also a directory.
    if (path.trailing || ['.', '..'].includes(path.parts.at(-1) ?? '') || targetParts.length === shared) return fail('directory')
    return `![](${relative.map(encode).join('/')})`
  }
  return relative.join('/') || '.'
}
/** Pure string conversion: no filesystem/clipboard reads, expansion or CWD assumptions. */
export function transformPaths(source: string, format: PathFormat, base = '', style: PathStyle = 'auto'): string {
  if (!source) return fail('empty')
  if (source.length > 1_048_576 || base.length > 32_768) return fail('limit')
  const paths = source.replace(/\r\n/g, '\n').split('\n')
  // One optional terminal newline is a text-list delimiter, not an extra pathname.
  if (paths.at(-1) === '') paths.pop()
  if (paths.length > 10_000) return fail('limit')
  try {
    if (format !== 'markdown-image') return paths.map((path) => transformOne(path, format, base, style)).join('\n')
    const output: string[] = []
    let bytes = 0
    for (const path of paths) {
      const line = transformOne(path, format, base, style)
      bytes += new TextEncoder().encode(line).byteLength + (output.length ? 1 : 0)
      if (bytes > MARKDOWN_IMAGE_MAX_BYTES) return fail('output-limit')
      output.push(line)
    }
    return output.join('\n')
  }
  catch (error) { if (error instanceof URIError) return fail('invalid'); throw error }
}
