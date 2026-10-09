export type XmlFormatterErrorCode = 'invalidXml' | 'xmlDtdUnsupported' | 'xmlParserUnavailable'

export class XmlFormatterError extends Error {
  readonly code: XmlFormatterErrorCode

  constructor(code: XmlFormatterErrorCode) {
    super(code)
    this.code = code
  }
}

type XmlPart = XmlElement | { kind: 'text' | 'raw' | 'cdata'; raw: string }
type XmlElement = {
  kind: 'element'
  name: string
  start: number
  end: number
  opening: string
  closing: string
  preserveSpace: boolean
  children: XmlPart[]
}

const xmlWhitespace = /^[\t\n\r ]*$/
const isTagSeparator = (character: string) => /[\t\n\r />]/.test(character)

function invalidXml(): never {
  throw new XmlFormatterError('invalidXml')
}

function validateXmlDocument(text: string): void {
  if (typeof DOMParser === 'undefined') throw new XmlFormatterError('xmlParserUnavailable')
  let document: Document
  try {
    document = new DOMParser().parseFromString(text, 'application/xml')
  } catch {
    invalidXml()
  }
  // Native XML parsers report errors in these namespaces. A normal user
  // element named <parsererror> is valid and must not be mistaken for one.
  const errorNamespaces = [
    'http://www.mozilla.org/newlayout/xml/parsererror.xml',
    'http://www.w3.org/1999/xhtml',
  ]
  if (!document.documentElement || errorNamespaces.some((namespace) =>
    document.getElementsByTagNameNS(namespace, 'parsererror').length > 0,
  )) invalidXml()
}

function hasXmlSpaceAttribute(tag: string): boolean {
  let quote = ''
  for (let index = 0; index < tag.length; index += 1) {
    const character = tag[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (index > 0 && xmlWhitespace.test(tag[index - 1]) && tag.startsWith('xml:space', index)) {
      const afterName = tag[index + 'xml:space'.length]
      if (afterName === '=' || xmlWhitespace.test(afterName)) return true
    }
  }
  return false
}

// This is a lexical scanner, not an XML validator. Retain source spans and
// leave XML grammar, namespaces, attributes and entities to the native parser.
function readXmlParts(text: string): XmlPart[] {
  const roots: XmlPart[] = []
  const stack: XmlElement[] = []
  let position = text.startsWith('\uFEFF') ? 1 : 0
  const append = (part: XmlPart) => (stack.at(-1)?.children ?? roots).push(part)

  while (position < text.length) {
    const start = position
    if (text[position] !== '<') {
      const next = text.indexOf('<', position)
      position = next < 0 ? text.length : next
      const raw = text.slice(start, position)
      if (!stack.length && !xmlWhitespace.test(raw)) invalidXml()
      append({ kind: 'text', raw })
      continue
    }

    const special = text.startsWith('<!--', start) ? { end: '-->', prefix: 4, kind: 'raw' as const }
      : text.startsWith('<![CDATA[', start) ? { end: ']]>', prefix: 9, kind: 'cdata' as const }
        : text.startsWith('<?', start) ? { end: '?>', prefix: 2, kind: 'raw' as const }
          : null
    if (special) {
      const end = text.indexOf(special.end, start + special.prefix)
      if (end < 0 || (special.kind === 'cdata' && !stack.length)) invalidXml()
      position = end + special.end.length
      append({ kind: special.kind, raw: text.slice(start, position) })
      continue
    }
    // Reject declarations before DOMParser can process a DTD or an entity.
    // The scanner has already skipped comments, CDATA and processing instructions.
    if (text.startsWith('<!', start)) throw new XmlFormatterError('xmlDtdUnsupported')

    let quote = ''
    position += 1
    while (position < text.length) {
      const character = text[position]
      if (quote) {
        if (character === quote) quote = ''
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
      position += 1
    }
    if (position === text.length) invalidXml()
    position += 1
    const raw = text.slice(start, position)
    const closing = raw.startsWith('</')
    const nameStart = closing ? 2 : 1
    let nameEnd = nameStart
    while (nameEnd < raw.length && !isTagSeparator(raw[nameEnd])) nameEnd += 1
    const name = raw.slice(nameStart, nameEnd)
    if (!name) invalidXml()

    if (closing) {
      const element = stack.pop()
      if (!element || element.name !== name) invalidXml()
      element.closing = raw
      element.end = position
    } else {
      const element: XmlElement = {
        kind: 'element', name, start, end: position, opening: raw, closing: '',
        // Treat any explicit xml:space conservatively, including values written
        // with character references. Preserving the whole span also covers inheritance.
        preserveSpace: hasXmlSpaceAttribute(raw), children: [],
      }
      append(element)
      if (!raw.endsWith('/>')) stack.push(element)
    }
  }
  if (stack.length || roots.filter((part) => part.kind === 'element').length !== 1) invalidXml()
  return roots
}

export function formatXml(
  text: string,
  operation: 'format' | 'compact',
  validateDocument: (source: string) => void = validateXmlDocument,
): string {
  const parts = readXmlParts(text)
  validateDocument(text)

  const render = (part: XmlPart, depth: number): string => {
    if (part.kind !== 'element') return part.raw
    // Without a DTD, even whitespace-only text may separate meaningful inline
    // content. Never discard it, or add whitespace inside text/CDATA/xml:space.
    if (operation === 'compact' || part.preserveSpace || !part.children.length ||
      part.children.some((child) => child.kind === 'text' || child.kind === 'cdata')) {
      return text.slice(part.start, part.end)
    }
    const indentation = '  '.repeat(depth)
    const children = part.children.map((child) => `${indentation}  ${render(child, depth + 1)}`)
    return `${part.opening}\n${children.join('\n')}\n${indentation}${part.closing}`
  }

  // XML only permits structural whitespace outside its one document element.
  // Compact that boundary; preserve every character inside the element.
  const separator = operation === 'format' ? '\n' : ''
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  return bom + parts.filter((part) => part.kind !== 'text').map((part) => render(part, 0)).join(separator)
}
