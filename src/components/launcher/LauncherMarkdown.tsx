import { Fragment, useMemo, type ReactNode } from 'react'
import { marked, type Token, type Tokens } from 'marked'

/**
 * Renders a text result declared as Markdown. Tokens become React elements;
 * raw HTML is shown as text and links are not followable, so model output
 * cannot inject markup or navigation.
 */
export function LauncherMarkdown({ text }: { text: string }) {
  const tokens = useMemo(() => marked.lexer(text), [text])
  return <div className="launcher-markdown">{blocks(tokens)}</div>
}

function blocks(tokens: Token[]): ReactNode {
  return tokens.map((token, index) => <Fragment key={index}>{block(token)}</Fragment>)
}

function block(token: Token): ReactNode {
  switch (token.type) {
    case 'heading': {
      const Heading = `h${Math.min(Math.max(token.depth, 3), 6)}` as 'h3'
      return <Heading>{inline(token.tokens)}</Heading>
    }
    case 'paragraph': return <p>{inline(token.tokens)}</p>
    case 'list': {
      const list = token as Tokens.List
      const items = list.items.map((item, index) => <li key={index}>{blocks(item.tokens)}</li>)
      return list.ordered ? <ol start={typeof list.start === 'number' ? list.start : undefined}>{items}</ol> : <ul>{items}</ul>
    }
    case 'blockquote': return <blockquote>{blocks(token.tokens ?? [])}</blockquote>
    case 'code': return <pre><code>{token.text}</code></pre>
    case 'hr': return <hr />
    case 'space': return null
    case 'text': {
      const text = token as Tokens.Text
      return <p>{text.tokens ? inline(text.tokens) : decode(text.text)}</p>
    }
    default: return 'raw' in token && typeof token.raw === 'string' ? <p>{token.raw}</p> : null
  }
}

function inline(tokens: Token[] | undefined): ReactNode {
  return tokens?.map((token, index) => <Fragment key={index}>{inlineToken(token)}</Fragment>)
}

function inlineToken(token: Token): ReactNode {
  switch (token.type) {
    case 'strong': return <strong>{inline(token.tokens)}</strong>
    case 'em': return <em>{inline(token.tokens)}</em>
    case 'del': return <del>{inline(token.tokens)}</del>
    case 'codespan': return <code>{decode(token.text)}</code>
    case 'br': return <br />
    case 'link': return <span className="launcher-markdown-link">{inline(token.tokens)}</span>
    case 'text': {
      const text = token as Tokens.Text
      return text.tokens ? inline(text.tokens) : decode(text.text)
    }
    case 'escape': return decode(token.text)
    default: return 'raw' in token && typeof token.raw === 'string' ? token.raw : null
  }
}

/** marked escapes entities in text tokens; show them as the characters they stand for. */
function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity] ?? _)
}
