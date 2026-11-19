/**
 * Text result well backed by the shared launcher Monaco editor.
 * Edits and selections are recorded as the choice's delivery text.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../../store'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { setResultTextOverride } from '../../workspace/launcher/resultTextOverride'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import {
  getLauncherResultEditor,
  launcherResultEditorTheme,
  setLauncherResultEditorContent,
  setLauncherResultEditorSubmit,
} from './sharedResultEditor'

const MIN_HEIGHT = 88
const MAX_HEIGHT = 288

export type LauncherResultEditorHandle = { focus: () => void }

type Props = {
  /** Delivery target; edits are keyed to it. Absent while the text is not deliverable yet. */
  choice?: LauncherResultChoice
  text: string
  language?: string
  label: string
  /** Esc inside the editor: give focus back to the launcher. */
  onExit: () => void
  /** ⌘↵ inside the editor: deliver (edited / selected) text. */
  onSubmit: () => void
}

function deliveryText(original: string): string | null {
  const { editor } = getLauncherResultEditor()
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (model && selection && !selection.isEmpty()) return model.getValueInRange(selection)
  const value = model?.getValue() ?? original
  return value === original ? null : value
}

export const LauncherResultEditor = forwardRef<LauncherResultEditorHandle, Props>(function LauncherResultEditor(
  { choice, text, language = 'plaintext', label, onExit, onSubmit },
  ref,
) {
  const slotRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [focused, setFocused] = useState(false)
  const theme = useAppStore((s) => s.settings.theme)
  const choiceRef = useRef(choice)
  choiceRef.current = choice
  const textRef = useRef(text)
  textRef.current = text

  useImperativeHandle(ref, () => ({ focus: () => getLauncherResultEditor().editor.focus() }), [])

  // Reparent the resident editor into this well.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const { container, editor } = getLauncherResultEditor()
    slot.appendChild(container)
    editor.layout()
    const syncHeight = () => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, editor.getContentHeight())))
    syncHeight()
    const recordEdit = () => {
      const target = choiceRef.current
      if (target) setResultTextOverride(target, deliveryText(textRef.current))
    }
    const disposables = [
      editor.onDidContentSizeChange(syncHeight),
      editor.onDidChangeModelContent(recordEdit),
      editor.onDidChangeCursorSelection(recordEdit),
      editor.onDidFocusEditorText(() => setFocused(true)),
      editor.onDidBlurEditorText(() => setFocused(false)),
    ]
    return () => {
      disposables.forEach((d) => d.dispose())
      container.remove()
    }
  }, [])

  // New result text resets any edit made to the previous one.
  useEffect(() => {
    setLauncherResultEditorContent(text, language)
    if (choice) setResultTextOverride(choice, null)
  }, [choice, text, language])

  useEffect(() => {
    getLauncherResultEditor().editor.updateOptions({ theme: launcherResultEditorTheme(theme) })
  }, [theme])

  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  useEffect(() => {
    const submit = () => submitRef.current()
    setLauncherResultEditorSubmit(submit)
    return () => setLauncherResultEditorSubmit(null)
  }, [])

  const escape = useCallback((event: globalThis.KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onExit()
    return true
  }, [onExit])
  useLauncherEscapeInterceptor(focused ? escape : null)

  // Keys typed in the editor stay in the editor (⌘↵ is a Monaco command, Esc the interceptor).
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') event.stopPropagation()
  }

  return (
    <div
      ref={slotRef}
      className="launcher-result-editor-slot"
      role="group"
      aria-label={label}
      style={{ height }}
      onKeyDown={handleKeyDown}
    />
  )
})
