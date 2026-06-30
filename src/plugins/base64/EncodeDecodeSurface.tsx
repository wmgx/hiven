import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'

type Method = 'base64' | 'url' | 'html' | 'slashes'
type Direction = 'encode' | 'decode'

type TransformResult =
  | { ok: true; value: string }
  | { ok: false; message: string }

const METHODS: Array<{ id: Method; title: string; hint: string }> = [
  { id: 'base64', title: 'Base64', hint: 'UTF-8 encode/decode' },
  { id: 'url', title: 'URL', hint: 'URIComponent' },
  { id: 'html', title: 'HTML', hint: 'Entities' },
  { id: 'slashes', title: 'Slashes', hint: 'Escape strings' },
]

function transform(text: string, method: Method, direction: Direction): TransformResult {
  try {
    if (method === 'base64') {
      return {
        ok: true,
        value: direction === 'encode'
          ? btoa(unescape(encodeURIComponent(text)))
          : decodeURIComponent(escape(atob(text.trim()))),
      }
    }
    if (method === 'url') {
      return { ok: true, value: direction === 'encode' ? encodeURIComponent(text) : decodeURIComponent(text.trim()) }
    }
    if (method === 'html') {
      return { ok: true, value: direction === 'encode' ? encodeHtml(text) : decodeHtml(text) }
    }
    return { ok: true, value: direction === 'encode' ? escapeSlashes(text) : unescapeSlashes(text) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function encodeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function decodeHtml(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function escapeSlashes(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function unescapeSlashes(text: string): string {
  return text
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
}

export function EncodeDecodeSurface(props: PluginSurfaceProps) {
  const { host } = props
  const [method, setMethod] = useState<Method>('base64')
  const [direction, setDirection] = useState<Direction>('encode')
  const [sourceText, setSourceText] = useState(props.initialText ?? 'hello world')
  const result = useMemo(() => transform(sourceText, method, direction), [direction, method, sourceText])
  const outputText = result.ok ? result.value : ''

  return (
    <section className="encode-decode-surface" aria-label="Encode / Decode Tools">
      <header className="encode-decode-surface__header">
        <div>
          <strong>Encode / Decode Tools</strong>
          <span>Base64, URL, HTML and string escaping</span>
        </div>
        <div className="encode-decode-surface__actions">
          <button type="button" onClick={() => outputText && host.clipboard.writeText(outputText)} disabled={!outputText}>Copy</button>
          <button type="button" onClick={() => host.close()}>Close</button>
        </div>
      </header>

      <div className="encode-decode-surface__controls">
        <div className="encode-decode-surface__methods" aria-label="Method">
          {METHODS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={candidate.id === method ? 'is-active' : ''}
              onClick={() => setMethod(candidate.id)}
            >
              <strong>{candidate.title}</strong>
              <span>{candidate.hint}</span>
            </button>
          ))}
        </div>
        <div className="encode-decode-surface__segmented" aria-label="Direction">
          <button type="button" className={direction === 'encode' ? 'is-active' : ''} onClick={() => setDirection('encode')}>Encode</button>
          <button type="button" className={direction === 'decode' ? 'is-active' : ''} onClick={() => setDirection('decode')}>Decode</button>
        </div>
      </div>

      <div className="encode-decode-surface__body">
        <label className="encode-decode-surface__pane">
          <span>Source</span>
          <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} />
        </label>
        <div className="encode-decode-surface__pane">
          <span>Preview</span>
          <pre className={result.ok ? '' : 'is-error'}>{result.ok ? result.value : result.message}</pre>
        </div>
      </div>
    </section>
  )
}
