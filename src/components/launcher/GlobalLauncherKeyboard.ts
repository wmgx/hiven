import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import type { CollectInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherMixedItem } from './LauncherMixedList'
import { shouldCustomizeParams } from './launcherParamShortcuts'
import { shouldIgnoreImeKeyDown } from '../../utils/imeKeyboard'

export function handleGlobalLauncherKeyDown({
  event,
  isImeComposingRef,
  launcherSettingsTarget,
  hostSurfaceTarget,
  surfaceFrame,
  itemPermissionFrame,
  controllerState,
  controllerRef,
  resultSelectedIndex,
  setResultSelectedIndex,
  toggleResultChoice,
  activateResultSecondary,
  pastePreviewText,
  isKeyboardNavRef,
  visibleFilteredLength,
  setSelectedIndex,
  selectedItem,
  isWorkflowObjectLauncherItem,
  selectItem,
  handleClipboardBackspace,
  hasClipboardHint,
  attachHintAsBlock,
  /** When true, Enter attaches the recent-clipboard hint (must be the focused row). */
  isClipboardHintSelected,
  selectedIndex,
  hasObjectActions,
  objectActionCount,
  setSelectedObjectActionIndex,
  expandSelectedObjectAction,
  executeSelectedObjectAction,
}: {
  event: ReactKeyboardEvent<HTMLElement>
  isImeComposingRef: MutableRefObject<boolean>
  launcherSettingsTarget: unknown
  hostSurfaceTarget?: unknown
  surfaceFrame: unknown
  itemPermissionFrame: unknown
  controllerState: { frames: Array<{ kind: string }>; error?: string | null; busy: boolean } | null | undefined
  controllerRef: MutableRefObject<{
    submitInput?: () => void | Promise<void>
    back?: () => boolean | void
    moveSuggestionHighlight?: (delta: number) => void
  } | null>
  resultSelectedIndex: number
  setResultSelectedIndex: (updater: number | ((index: number) => number)) => void
  toggleResultChoice: (choice: unknown, frame: ResultFrame) => void
  /** Package 4: result secondary e.g. return-to-launcher */
  activateResultSecondary?: (choice: { secondaryActions?: Array<{ id: string }>; preview?: string; title?: string }, actionId: string) => void
  pastePreviewText?: (text: string) => void | Promise<void>
  isKeyboardNavRef: MutableRefObject<boolean>
  visibleFilteredLength: number
  setSelectedIndex: (
    updater: number | ((index: number) => number),
    options?: { pin?: boolean },
  ) => void
  selectedItem?: LauncherMixedItem
  isWorkflowObjectLauncherItem: (item?: LauncherMixedItem) => boolean
  selectItem: (item: LauncherMixedItem | undefined, customizeParams?: boolean) => void
  handleClipboardBackspace?: (queryEmpty: boolean) => boolean
  hasClipboardHint?: boolean
  attachHintAsBlock?: () => void
  isClipboardHintSelected?: boolean
  /** Current list selection index; -1 means recent-clipboard hint is focused. */
  selectedIndex?: number
  hasObjectActions?: boolean
  objectActionCount?: number
  setSelectedObjectActionIndex?: (updater: number | ((index: number) => number)) => void
  expandSelectedObjectAction?: () => void
  executeSelectedObjectAction?: (keepOpen?: boolean) => void
}) {
  if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
  if (event.defaultPrevented) return
  if (event.key === 'Escape') return
  if (launcherSettingsTarget) return
  if (hostSurfaceTarget) return
  if (surfaceFrame) return
  if (itemPermissionFrame) return

  if (controllerState && controllerState.frames.length > 1) {
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind === 'param-input') return

    if (topFrame.kind === 'collect-input') {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        controllerRef.current?.moveSuggestionHighlight?.(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        controllerRef.current?.moveSuggestionHighlight?.(-1)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void controllerRef.current?.submitInput?.()
        return
      }
      if (event.key === 'Backspace' && !(topFrame as CollectInputFrame).inputText) {
        event.preventDefault()
        event.stopPropagation()
        controllerRef.current?.back?.()
        return
      }
      return
    }

    if (topFrame.kind === 'result') {
      const resultFrame = topFrame as ResultFrame
      const choices = resultFrame.output.choices
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setResultSelectedIndex((index) => Math.min(index + 1, Math.max(0, choices.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setResultSelectedIndex((index) => Math.max(index - 1, 0))
        return
      }
      // Space: prefer event.code — some layouts / IME report event.key oddly.
      const isSpace = event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space'
      if (event.key === 'Enter' || isSpace) {
        event.preventDefault()
        event.stopPropagation()
        const choice = choices[Math.min(resultSelectedIndex, Math.max(0, choices.length - 1))] as
          | { secondaryActions?: Array<{ id: string }>; preview?: string; title?: string }
          | undefined
        if (!choice) return
        // Align with collect-input destinations: ⇧↵ paste · ⌘↵ return · ↵ primary
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          if (choice.secondaryActions?.some((a) => a.id === 'return-to-launcher')) {
            activateResultSecondary?.(choice, 'return-to-launcher')
            return
          }
        }
        if (event.key === 'Enter' && event.shiftKey && pastePreviewText) {
          const text = (choice.preview ?? choice.title ?? '').trim()
          if (text) {
            void pastePreviewText(text)
            return
          }
        }
        toggleResultChoice(choice, resultFrame)
        return
      }
      return
    }
  }

  if (hasObjectActions && event.key === 'ArrowDown') {
    event.preventDefault()
    isKeyboardNavRef.current = true
    setSelectedObjectActionIndex?.((index) => Math.min(index + 1, Math.max(0, (objectActionCount ?? 0) - 1)))
    return
  }
  if (hasObjectActions && event.key === 'ArrowUp') {
    event.preventDefault()
    isKeyboardNavRef.current = true
    setSelectedObjectActionIndex?.((index) => Math.max(index - 1, 0))
    return
  }
  if (hasObjectActions && (event.key === 'Tab' || event.key === 'ArrowRight')) {
    event.preventDefault()
    expandSelectedObjectAction?.()
    return
  }
  if (hasObjectActions && event.key === 'Enter') {
    event.preventDefault()
    executeSelectedObjectAction?.(event.metaKey || event.ctrlKey)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    isKeyboardNavRef.current = true
    setSelectedIndex((index) => Math.min(index + 1, Math.max(0, visibleFilteredLength - 1)))
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    isKeyboardNavRef.current = true
    // When a recent-clipboard hint is shown, index -1 focuses the hint row above the list.
    const minIndex = hasClipboardHint ? -1 : 0
    setSelectedIndex((index) => Math.max(index - 1, minIndex))
    return
  }
  if (event.key === 'Tab' && isWorkflowObjectLauncherItem(selectedItem)) {
    event.preventDefault()
    selectItem(selectedItem)
    return
  }
  if (event.key === 'Backspace' && handleClipboardBackspace) {
    const input = event.target as HTMLInputElement | null
    const queryEmpty = !input?.value
    if (queryEmpty && handleClipboardBackspace(true)) {
      event.preventDefault()
      return
    }
  }
  // Only attach the timeout clipboard hint when it is the focused row — never steal Enter from list selection.
  if (
    event.key === 'Enter'
    && hasClipboardHint
    && (isClipboardHintSelected || selectedIndex === -1)
    && attachHintAsBlock
  ) {
    event.preventDefault()
    attachHintAsBlock()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    selectItem(selectedItem, shouldCustomizeParams(event.metaKey, event.ctrlKey))
  }
}
