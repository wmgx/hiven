import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'

type JsonFormatResult =
  | { ok: true; formatted: string }
  | { ok: false; message: string }

function formatJson(text: string): JsonFormatResult {
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(text), null, 2) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function JsonSurface(props: PluginSurfaceProps) {
  const { host } = props
  const initialText = props.initialText?.trim()
  const [inputText, setInputText] = useState(initialText ?? '')
  const result = useMemo(() => formatJson(inputText), [inputText])
  const outputText = result.ok ? result.formatted : ''

  return (
    <section className="json-surface" aria-label="JSON">
      <header className="json-surface__header">
        <strong>JSON</strong>
        <div className="json-surface__spacer" />
        <button type="button" onClick={() => outputText && host.clipboard.writeText(outputText)} disabled={!outputText}>Copy</button>
        <button type="button" onClick={() => host.close()}>Close</button>
      </header>
      <div className="json-surface__body">
        <textarea
          className="json-surface__input"
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          spellCheck={false}
          placeholder="Paste JSON here..."
        />
        <pre className={`json-surface__output ${result.ok ? '' : 'is-error'}`}>{result.ok ? result.formatted : result.message}</pre>
      </div>
    </section>
  )
}
