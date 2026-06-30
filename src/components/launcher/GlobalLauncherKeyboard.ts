import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import type { CollectInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherMixedItem } from './LauncherMixedList'
import { shouldCustomizeParams } from './launcherParamShortcuts'
import { shouldIgnoreImeKeyDown } from '../../utils/imeKeyboard'

export function handleGlobalLauncherKeyDown({
  event,
  isImeComposingRef,
  launcherSettingsTarget,
  closeSettingsDialog,
  focusSearchInputAfterBack,
  surfaceFrame,
  leaveSurface,
  itemPermissionFrame,
  cancelItemPermissionPrompt,
  controllerState,
  controllerRef,
  resultSelectedIndex,
  setResultSelectedIndex,
  toggleResultChoice,
  closeLauncher,
  isKeyboardNavRef,
  visibleFilteredLength,
  setSelectedIndex,
  selectedItem,
  isWorkflowObjectLauncherItem,
  selectItem,
  handleClipboardBackspace,
  hasObjectActions,
  objectActionCount,
  setSelectedObjectActionIndex,
  expandSelectedObjectAction,
  executeSelectedObjectAction,
}: {
  event: ReactKeyboardEvent<HTMLElement>
  isImeComposingRef: MutableRefObject<boolean>
  launcherSettingsTarget: unknown
  closeSettingsDialog: () => void
  focusSearchInputAfterBack: () => void
  surfaceFrame: unknown
  leaveSurface: () => void
  itemPermissionFrame: unknown
  cancelItemPermissionPrompt: () => void
  controllerState: { frames: Array<{ kind: string }>; error?: string | null; busy: boolean } | null | undefined
  controllerRef: MutableRefObject<{
    submitInput?: () => void | Promise<void>
    back?: () => boolean | void
  } | null>
  resultSelectedIndex: number
  setResultSelectedIndex: (updater: number | ((index: number) => number)) => void
  toggleResultChoice: (choice: unknown, frame: ResultFrame) => void
  closeLauncher: () => void
  isKeyboardNavRef: MutableRefObject<boolean>
  visibleFilteredLength: number
  setSelectedIndex: (updater: number | ((index: number) => number)) => void
  selectedItem?: LauncherMixedItem
  isWorkflowObjectLauncherItem: (item?: LauncherMixedItem) => boolean
  selectItem: (item: LauncherMixedItem | undefined, customizeParams?: boolean) => void
  handleClipboardBackspace?: (queryEmpty: boolean) => boolean
  hasObjectActions?: boolean
  objectActionCount?: number
  setSelectedObjectActionIndex?: (updater: number | ((index: number) => number)) => void
  expandSelectedObjectAction?: () => void
  executeSelectedObjectAction?: (keepOpen?: boolean) => void
}) {
  if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && launcherSettingsTarget) {
    event.preventDefault()
    event.stopPropagation()
    closeSettingsDialog()
    focusSearchInputAfterBack()
    return
  }
  if (launcherSettingsTarget) return

  if (surfaceFrame) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      leaveSurface()
    }
    return
  }

  if (itemPermissionFrame) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelItemPermissionPrompt()
    }
    return
  }

  if (controllerState && controllerState.frames.length > 1) {
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind === 'param-input') return

    if (topFrame.kind === 'collect-input') {
      if (event.key === 'Enter') {
        event.preventDefault()
        void controllerRef.current?.submitInput?.()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        controllerRef.current?.back?.()
        focusSearchInputAfterBack()
        return
      }
      if (event.key === 'Backspace' && !(topFrame as CollectInputFrame).inputText) {
        event.preventDefault()
        event.stopPropagation()
        controllerRef.current?.back?.()
        focusSearchInputAfterBack()
        return
      }
      return
    }

    if (topFrame.kind === 'result') {
      const resultFrame = topFrame as ResultFrame
      const choices = resultFrame.output.choices
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setResultSelectedIndex((index) => Math.min(index + 1, Math.max(0, choices.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setResultSelectedIndex((index) => Math.max(index - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const choice = choices[Math.min(resultSelectedIndex, Math.max(0, choices.length - 1))]
        if (choice) toggleResultChoice(choice, resultFrame)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        controllerRef.current?.back?.()
        focusSearchInputAfterBack()
        return
      }
      return
    }
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeLauncher()
    return
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
    setSelectedIndex((index) => Math.max(index - 1, 0))
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
  if (event.key === 'Enter') {
    event.preventDefault()
    selectItem(selectedItem, shouldCustomizeParams(event.metaKey, event.ctrlKey))
  }
}
