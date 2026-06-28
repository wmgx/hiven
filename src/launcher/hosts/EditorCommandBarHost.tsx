import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useAppStore } from '../../store'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../../utils/imeKeyboard'
import type { CollectInputFrame, ParamInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import { LauncherParamStep } from '../../components/launcher/LauncherParamStep'
import { LauncherView } from '../../components/launcher/LauncherView'
import { shouldCustomizeParams, supportsDefaultParamRun } from '../../components/launcher/launcherParamShortcuts'
import { LauncherCollectInputStep } from '../../components/launcher/LauncherCollectInputStep'
import { LauncherDomainSearchStep } from '../../components/launcher/LauncherDomainSearchStep'
import { LauncherResultStep } from '../../components/launcher/LauncherResultStep'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'

export function EditorCommandBarHost() {
  const open = useAppStore((s) => s.editorCommandBarOpen)
  const setOpen = useAppStore((s) => s.setEditorCommandBarOpen)
  const pinPluginCommand = useAppStore((s) => s.pinPluginCommand)
  const locale = useAppStore((s) => s.locale)

  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isKeyboardNavRef = useRef(false)
  const isImeComposingRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controllerRef,
    controllerState,
    rankedItems: rankedLauncherItems,
  } = useLauncherSession({
    hostId: 'editor-command-bar',
    open,
    requestClose: closePalette,
    staticItemFilter: filterEditorCommandBarItems,
  })

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    })
    return () => {
      cancelled = true
    }
  }, [open, setQuery, setSelectedIndex])

  const topFrame = controllerState?.frames[controllerState.frames.length - 1]
  const inControllerFrame = topFrame && topFrame.kind !== 'list'

  function closePalette() {
    setOpen(false)
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }

  function focusSearchInputAfterBack() {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function selectItem(item: DomainLauncherItem | undefined, customizeParams = false) {
    if (!item) return
    if (!customizeParams && !supportsDefaultParamRun(item)) {
      void controllerRef.current?.selectItem(item, { customizeParams: true })
      return
    }
    void controllerRef.current?.selectItem(item, { customizeParams })
  }

  function pinLauncherItem(item: DomainLauncherItem) {
    if (item.pinnable === false) return
    pinPluginCommand({
      kind: 'plugin-command',
      actionId: item.systemKey,
      pluginId: item.pluginId ?? '',
      title: item.display.title,
      titleI18n: item.display.titleI18n,
      icon: item.display.icon,
      isDev: item.source === 'dev',
      live: { pinnable: true },
    })
    closePalette()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
    if (inControllerFrame) return

    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      isKeyboardNavRef.current = true
      setSelectedIndex((index) => Math.min(index + 1, Math.max(0, rankedLauncherItems.length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      isKeyboardNavRef.current = true
      setSelectedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectItem(rankedLauncherItems[selectedIndex], shouldCustomizeParams(event.metaKey, event.ctrlKey))
    }
  }

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 flex items-start justify-center pt-[54px] z-50 palette-overlay ${open ? 'open' : ''}`}
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1000 }}
      onClick={(event) => { if (event.target === event.currentTarget) closePalette() }}
    >
      <LauncherView
        hostId="editor-command-bar"
        ref={panelRef}
        tabIndex={-1}
        busy={controllerState?.busy ?? false}
        className="command-launcher-panel global-launcher-panel overflow-hidden outline-none palette-panel"
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        {!inControllerFrame && (
          <LauncherDomainSearchStep
            inputRef={inputRef}
            query={query}
            setQuery={(value) => { setQuery(value); setSelectedIndex(0) }}
            items={rankedLauncherItems}
            selectedIndex={selectedIndex}
            selectItem={selectItem}
            onPinItem={pinLauncherItem}
            setSelectedIndex={setSelectedIndex}
            isKeyboardNavRef={isKeyboardNavRef}
            locale={locale}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
          />
        )}

        {topFrame?.kind === 'collect-input' && (
          <LauncherCollectInputStep
            frame={topFrame as CollectInputFrame}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
            onInputChange={(text) => controllerRef.current?.setInputText(text)}
            onSubmit={() => controllerRef.current?.submitInput()}
            onBack={() => {
              controllerRef.current?.back()
              focusSearchInputAfterBack()
            }}
            locale={locale}
          />
        )}

        {topFrame?.kind === 'param-input' && (
          <LauncherParamStep
            frame={topFrame as ParamInputFrame}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
            locale={locale}
            onQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
            onSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
            onCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
            onBack={() => {
              controllerRef.current?.back()
              focusSearchInputAfterBack()
            }}
          />
        )}

        {topFrame?.kind === 'result' && (
          <LauncherResultStep
            frame={topFrame as ResultFrame}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
            onActivateChoice={(choice) => controllerRef.current?.activateChoice(choice)}
            onActivateSecondary={(choice, actionId) => controllerRef.current?.activateSecondary(choice, actionId)}
            onSubmitSelection={(choices) => controllerRef.current?.submitResultSelection(choices)}
            onBack={() => {
              controllerRef.current?.back()
              focusSearchInputAfterBack()
            }}
            locale={locale}
          />
        )}
      </LauncherView>
    </div>
  )
}

function filterEditorCommandBarItems(items: DomainLauncherItem[]): DomainLauncherItem[] {
  return items.filter((item) => {
    if (item.systemKey.startsWith('plugin-settings:')) return false
    if (item.kind !== 'host') return true
    return item.systemKey.startsWith('host:pane:') || item.systemKey.startsWith('host:editor:attach-') || item.systemKey === 'host:global:search-all-hiven'
  })
}
