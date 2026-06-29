/**
 * useEditorObjectBlock — React hook for Editor Cmd+K Object Block.
 *
 * When the Editor Command Bar opens, this hook reads the current editor
 * selection or document and creates an EditorObjectBlock from it.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §2.6 / §9.5
 *
 * Key differences from clipboard object block:
 *  - Does NOT use clipboard freshness rules
 *  - Directly reads editor selection/document context
 *  - Source is 'editor-selection' or 'editor-document'
 *  - Recommends editor-local actions only
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LauncherObjectBlock } from './objectBlock'
import { createEditorSelectionObjectBlock, createEditorDocumentObjectBlock } from './objectBlock'
import { detectClipboardType } from './clipboardSnapshot'

export type EditorObjectBlockState = {
  block: LauncherObjectBlock | null
  removeBlock: () => void
  handleBackspace: (queryEmpty: boolean) => boolean
}

export function useEditorObjectBlock(params: {
  open: boolean
  getSelectionText: () => string
  getActiveText: () => string
}): EditorObjectBlockState {
  const { open, getSelectionText, getActiveText } = params
  const [block, setBlock] = useState<LauncherObjectBlock | null>(null)
  const didReadRef = useRef(false)

  useEffect(() => {
    if (!open) {
      didReadRef.current = false
      setBlock(null)
      return
    }
    if (didReadRef.current) return
    didReadRef.current = true

    const selection = getSelectionText()
    if (selection && selection.trim().length > 0) {
      const kind = detectClipboardType(selection)
      const lineCount = selection.split('\n').length
      setBlock(createEditorSelectionObjectBlock({ text: selection, kind, lineCount }))
      return
    }

    const activeText = getActiveText()
    if (activeText && activeText.trim().length > 0) {
      const kind = detectClipboardType(activeText)
      const charCount = activeText.length
      setBlock(createEditorDocumentObjectBlock({ text: activeText, kind, charCount }))
      return
    }

    setBlock(null)
  }, [open, getSelectionText, getActiveText])

  const removeBlock = useCallback(() => {
    setBlock(null)
  }, [])

  const handleBackspace = useCallback((queryEmpty: boolean): boolean => {
    if (!queryEmpty) return false
    if (!block) return false
    if (block.selectedForDelete) {
      setBlock(null)
      return true
    }
    setBlock((prev) => prev ? { ...prev, selectedForDelete: true } : null)
    return true
  }, [block])

  return { block, removeBlock, handleBackspace }
}
