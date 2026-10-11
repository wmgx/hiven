import { useCallback, useEffect, useRef, type ComponentProps } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { TextEditor } from '@hiven/plugin-ui'
import { jsonCursorPath } from './cursorPath'
type Editor = Parameters<NonNullable<ComponentProps<typeof TextEditor>['onReady']>>[0]

/** Uses the existing editor primitive; all JSON meaning stays in this plugin. */
export function useJsonCursorPath(host: PluginSurfaceProps['host'], t: PluginSurfaceProps['t'], report: (message: string) => void) {
  const editorRef = useRef<Editor | null>(null)
  const cleanup = useRef<(() => void) | undefined>(undefined)
  const active = useRef(true)
  const revision = useRef(0)
  const copy = async (kind: 'jsonPath' | 'pointer') => {
    const editor = editorRef.current, model = editor?.getModel(), position = editor?.getPosition()
    if (!editor || !model || !position) { report(t('cursor.position')); return }
    const result = jsonCursorPath(model.getValue(), model.getOffsetAt(position))
    if (!result.ok) { report(t(`cursor.${result.reason}`)); return }
    const identity = ++revision.current
    const version = model.getVersionId()
    const current = () => active.current && identity === revision.current && editorRef.current === editor && model.getVersionId() === version
    try {
      await host.clipboard.writeText(result.value[kind])
      if (current()) report(t(kind === 'pointer' && result.value.pointer === '' ? 'cursor.rootPointerCopied' : 'cursor.copied', { kind: kind === 'jsonPath' ? 'JSONPath' : 'JSON Pointer' }))
    } catch { if (current()) report(t('cursor.copyFailed')) }
  }
  const copyRef = useRef(copy)
  copyRef.current = copy
  useEffect(() => {
    active.current = true
    return () => { active.current = false; cleanup.current?.(); editorRef.current = null }
  }, [])
  const onReady = useCallback((editor: Editor) => {
    revision.current++
    cleanup.current?.()
    editorRef.current = editor
    const actions = (['jsonPath', 'pointer'] as const).map((kind) => editor.addAction({
      id: `json-tools.copy-cursor-${kind}`, label: t(`cursor.${kind}`), contextMenuGroupId: 'navigation',
      run: () => copyRef.current(kind),
    }))
    const invalidate = () => { revision.current++; report('') }
    const changed = editor.onDidChangeModelContent(invalidate)
    const moved = editor.onDidChangeCursorPosition(invalidate)
    const dispose = () => {
      actions.forEach((item) => item.dispose()); changed.dispose(); moved.dispose()
      if (cleanup.current === dispose && editorRef.current === editor) { revision.current++; editorRef.current = null }
    }
    cleanup.current = dispose
    return () => { if (editorRef.current === editor) cleanup.current?.(); else dispose() }
  }, [t, report])
  useEffect(() => { if (editorRef.current) onReady(editorRef.current) }, [onReady])
  return { onReady, copy }
}
