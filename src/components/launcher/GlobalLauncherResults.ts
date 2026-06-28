import { useCallback, useEffect, useState } from 'react'
import type { LauncherController, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'

export function useGlobalLauncherResultFrame({
  controller,
  activeResultFrame,
}: {
  controller: LauncherController | null
  activeResultFrame: ResultFrame | null
}) {
  const [resultSelectedIndex, setResultSelectedIndex] = useState(0)
  const [selectedResultChoiceIds, setSelectedResultChoiceIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (activeResultFrame?.kind !== 'result') return
    setResultSelectedIndex(0)
    setSelectedResultChoiceIds(new Set())
  }, [activeResultFrame?.kind, activeResultFrame?.kind === 'result' ? activeResultFrame.sourceTitle : undefined])

  const activateResultChoice = useCallback((choice: LauncherResultChoice) => {
    void controller?.activateChoice(choice)
  }, [controller])

  const toggleResultChoice = useCallback((choice: LauncherResultChoice, frame: ResultFrame) => {
    const selection = frame.output.selection
    if (selection?.type !== 'multi') {
      activateResultChoice(choice)
      return
    }
    setSelectedResultChoiceIds((current) => {
      const next = new Set(current)
      if (next.has(choice.id)) {
        next.delete(choice.id)
      } else if (next.size < selection.max) {
        next.add(choice.id)
      }
      if (next.size >= selection.max) {
        const selectedChoices = frame.output.choices.filter((item) => next.has(item.id))
        queueMicrotask(() => { void controller?.submitResultSelection(selectedChoices) })
      }
      return next
    })
  }, [activateResultChoice, controller])

  return {
    resultSelectedIndex,
    setResultSelectedIndex,
    selectedResultChoiceIds,
    activateResultChoice,
    toggleResultChoice,
  }
}
