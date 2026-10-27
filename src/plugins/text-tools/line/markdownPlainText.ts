import { Marked, Tokenizer, type Token, type Tokens } from 'marked'

export const MARKDOWN_INPUT_LIMIT = 128 * 1024
export const MARKDOWN_OUTPUT_LIMIT = 512 * 1024
const encoder = new TextEncoder()
export function checkMarkdownInput(text: string) {
  if (text.length > MARKDOWN_INPUT_LIMIT || encoder.encode(text).length > MARKDOWN_INPUT_LIMIT) throw new Error('limit')
}
/** Pure conversion; called in a disposable, time-limited worker, never a renderer. */
export function markdownPlainText(input: string, imageLabel = 'Image'): string {
  checkMarkdownInput(input)
  const tokenizer = new Tokenizer()
  const definition = tokenizer.def
  tokenizer.def = function (src) {
    const token = definition.call(this, src)
    // Footnotes are outside this operation's dialect; keep their syntax literal.
    return token?.tag.startsWith('^') ? undefined : token
  }
  const table = tokenizer.table
  tokenizer.table = function (src) {
    const token = table.call(this, src)
    if (!token) return
    // GFM drops cells beyond the header width. Fall back to the original text
    // for such tables so conversion cannot silently discard extra columns.
    const cells = (line: string) => {
      const text = line.trim()
      let count = 1, slashes = 0, lastPipe = false
      for (let index = 0; index < text.length; index++) {
        const char = text[index]
        lastPipe = char === '|' && slashes % 2 === 0
        if (lastPipe) count++
        slashes = char === '\\' ? slashes + 1 : 0
      }
      return count - (text.startsWith('|') ? 1 : 0) - (lastPipe ? 1 : 0)
    }
    if (token.raw.trimEnd().split('\n').slice(2).some(line => cells(line) > token.header.length)) return
    return token
  }
  const marked: Marked = new Marked({ gfm: true, tokenizer, extensions: [{
    name: 'keptDefinition', level: 'block',
    tokenizer(src, tokens) {
      // Match marked's paragraph-continuation rule. No start() hook: definitions
      // cannot interrupt a paragraph. The Lexer initializes this tokenizer.
      if (['paragraph', 'text'].includes(tokens.at(-1)?.type ?? '')) return
      const definition = marked.defaults.tokenizer!.def(src)
      if (!definition) return
      if (!Object.hasOwn(this.lexer.tokens.links, definition.tag)) {
        this.lexer.tokens.links[definition.tag] = { href: definition.href, title: definition.title }
      }
      // Keep *all* definitions at their original location, including duplicate
      // and unused addresses, rather than losing them through lexer.links.
      return { ...definition, type: 'keptDefinition' }
    },
  }] })
  let nodes = 0
  const bounded = (text: string) => {
    if (text.length > MARKDOWN_OUTPUT_LIMIT) throw new Error('limit')
    return text
  }
  const visit = (tokens: Token[], depth: number, inline = false, compactBlocks = false): string => {
    if (depth > 64) throw new Error('limit')
    const output: string[] = []
    let length = 0
    for (const token of tokens) {
      if (++nodes > 20000) throw new Error('limit')
      const children = () => visit('tokens' in token && Array.isArray(token.tokens) ? token.tokens : [], depth + 1, true)
      let text: string
      switch (token.type) {
        case 'space': continue
        case 'heading': case 'paragraph': text = children(); break
        case 'text': text = 'tokens' in token && Array.isArray(token.tokens) ? children() : token.raw; break
        case 'escape': text = token.raw.slice(1); break
        case 'strong': case 'em': text = children(); break
        case 'del': text = `~~${children()}~~`; break
        case 'codespan': {
          const fence = /^`+/.exec(token.raw)![0].length
          text = token.raw.slice(fence, -fence)
          break
        }
        case 'code': text = (token.lang ? `[${token.lang}]\n` : '') + token.text; break
        case 'br': text = '\n'; break
        case 'hr': text = '---'; break
        case 'html': case 'keptDefinition': text = token.raw; break
        case 'link': case 'image': {
          const automatic = token.type === 'link' && (/^<[^<>]+>$/.test(token.raw) || /^(?:https?:\/\/|www\.)/i.test(token.raw))
          const label = automatic ? token.raw.startsWith('<') ? token.raw.slice(1, -1) : token.raw : token.type === 'image' ? token.text : children()
          // marked escapes autolink hrefs; use the original spelling instead.
          const href = /^<[^<>]+>$/.test(token.raw) ? token.raw.slice(1, -1)
            : /^(?:https?:\/\/|www\.)/i.test(token.raw) ? (token.raw.startsWith('www.') ? `http://${token.raw}` : token.raw) : token.href
          const destination = label === href && !token.title ? label : `${label}${label ? ' ' : ''}(${href}${token.title ? ` "${token.title}"` : ''})`
          text = (token.type === 'image' ? `${imageLabel}: ` : '') + destination
          break
        }
        case 'blockquote': text = visit((token as Tokens.Blockquote).tokens, depth + 1).split('\n').map(line => `> ${line}`).join('\n'); break
        case 'list': text = (token as Tokens.List).items.map((item, index) => {
          if (++nodes > 20000) throw new Error('limit')
          const prefix = `${token.ordered ? `${Number(token.start) + index}.` : '-'} ${item.task ? item.checked ? '[x] ' : '[ ] ' : ''}`
          const indent = ' '.repeat(token.ordered ? `${Number(token.start) + index}. `.length : 2)
          return visit(item.tokens, depth + 1, false, !item.loose).split('\n').map((line, lineIndex) => lineIndex ? line ? indent + line : '' : prefix + line).join('\n')
        }).join('\n'); break
        case 'table': {
          const cell = (tokens: Token[]) => visit(tokens, depth + 1, true).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n')
          text = [(token as Tokens.Table).header, ...(token as Tokens.Table).rows].map(row => row.map(value => cell(value.tokens)).join('\t')).join('\n')
          break
        }
        default: text = token.raw // Unknown syntax is never silently discarded.
      }
      // Remove structural token terminators only, never code/content whitespace.
      if (token.type === 'html' || token.type === 'keptDefinition') text = text.replace(/\n+$/, '')
      length += text.length + (inline || !output.length ? 0 : 2)
      if (length > MARKDOWN_OUTPUT_LIMIT) throw new Error('limit')
      output.push(text)
    }
    return bounded(output.join(inline ? '' : compactBlocks ? '\n' : '\n\n'))
  }
  const result = visit(marked.lexer(input), 0)
  if (encoder.encode(result).length > MARKDOWN_OUTPUT_LIMIT) throw new Error('limit')
  return result
}
