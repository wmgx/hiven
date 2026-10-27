import { useEffect, useRef, useState } from 'react'
import App from '../../App'
import { PluginSurfaceWindow } from '../../components/PluginSurfaceWindow'
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import { ToastHud } from '../../components/ToastHud'
import { registerAiProvider } from '../ai/runtime'
import { sandbox } from './native'
import './sandbox.css'

export default function Sandbox() {
  const locale = useAppStore(state => state.settings.locale)
  const [editor, setEditor] = useState(sandbox.editor)
  const [visible, setVisible] = useState(sandbox.launcherVisible)
  const [surface, setSurface] = useState(sandbox.surfaceWindow)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => sandbox.subscribe(() => { setEditor(sandbox.editor()); setVisible(sandbox.launcherVisible()); setSurface(sandbox.surfaceWindow()) }), [])
  useEffect(() => { sandbox.setLocale(locale) }, [locale])
  useEffect(() => { field.current?.setSelectionRange(editor.selection.start, editor.selection.end) }, [editor])
  useEffect(() => registerAiProvider({
    id: 'sandbox', authentication: 'none', fallbackPolicy: 'never',
    describe: async () => ({ id: 'sandbox', kind: 'sandbox', name: t(locale, 'sandbox.ai'), status: 'ready', modelCatalog: 'complete', authentication: 'none', capabilities: ['text.generate'],
      agents: [{ id: 'sandbox-text', name: t(locale, 'sandbox.ai'), capabilities: ['text.generate'], inputModalities: ['text'], supportedEfforts: [], isDefault: true }] }),
    async *stream(request) {
      yield { type: 'run.started', runId: request.runId, providerId: 'sandbox', agentId: 'sandbox-text' }
      for (let i = 0; i < 12 && !request.signal?.aborted; i++) {
        await new Promise(resolve => setTimeout(resolve, 200))
        if (!request.signal?.aborted) yield { type: 'text.delta', runId: request.runId, delta: t(locale, 'sandbox.aiChunk') }
      }
      yield { type: 'completed', runId: request.runId, status: request.signal?.aborted ? 'cancelled' : 'completed' }
    },
    async cancel() {},
  }), [locale])
  return <>
    <div className="sandbox-launcher" hidden={!visible || Boolean(surface)}><App /></div>
    {surface && <div className="sandbox-surface" style={{ width: surface.width, height: surface.height }}><PluginSurfaceWindow key={surface.key} /></div>}
    <aside className="sandbox-panel" aria-label={t(locale, 'sandbox.title')}>
      <strong>{t(locale, 'sandbox.title')}</strong>
      <p>{t(locale, 'sandbox.isolation')}</p>
      <label htmlFor="sandbox-editor">{t(locale, 'sandbox.editor')}</label>
      <textarea id="sandbox-editor" ref={field} value={editor.text}
        onFocus={() => void sandbox.focusEditor()}
        onChange={event => sandbox.setEditor(event.target.value, { start: event.target.selectionStart, end: event.target.selectionEnd })}
        onSelect={event => {
          const field = event.currentTarget
          if (field.selectionStart !== editor.selection.start || field.selectionEnd !== editor.selection.end) sandbox.setEditor(field.value, { start: field.selectionStart, end: field.selectionEnd })
        }} />
      <button type="button" onClick={() => sandbox.copy(editor.text)}>{t(locale, 'sandbox.copy')}</button>
      <button type="button" onClick={() => void sandbox.open()}>{t(locale, 'sandbox.open')}</button>
      <div className="sandbox-hud"><ToastHud /></div>
    </aside>
  </>
}
