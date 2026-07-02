import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../../store'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { filterEditorCommandBarItems } from '../../workspace/launcher/types'
import { resolveDisplayTitle, resolveDisplaySubtitle } from '../../workspace/launcher/display'
import { resolveIcon } from '../../utils/resolveIcon'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { createQuickEditorLauncherApi } from '../../workspace/quickEditor/quickEditorActions'
import { GlobalLauncherFrameSwitch } from '../launcher/GlobalLauncherFrames'
import { useGlobalLauncherResultFrame } from '../launcher/GlobalLauncherResults'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'

export function QuickEditorCommandOverlay() {
  const open = useAppStore((s) => s.quickEditorCommandOpen)
  const closeCommand = useAppStore((s) => s.closeQuickEditorCommand)
  const locale = useAppStore((s) => s.locale)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controllerRef,
    controllerState,
    rankedItems,
  } = useLauncherSession({
    hostId: 'quick-editor-command',
    open,
    requestClose: closeCommand,
    staticItemFilter: filterEditorCommandBarItems,
    makeApi: createQuickEditorLauncherApi,
  })
  const activeResultFrame = controllerState?.frames.length
    ? controllerState.frames[controllerState.frames.length - 1]
    : null
  const {
    resultSelectedIndex,
    setResultSelectedIndex,
    selectedResultChoiceIds,
    activateResultChoice,
    toggleResultChoice,
  } = useGlobalLauncherResultFrame({
    controller: controllerRef.current,
    activeResultFrame: activeResultFrame?.kind === 'result' ? activeResultFrame : null,
  })
  const emptyClipboardBlock = useMemo<ClipboardObjectBlockState>(() => ({
    mode: 'search-only',
    block: null,
    hint: null,
    removeBlock: () => {},
    selectBlockForDelete: () => {},
    handleBackspace: () => false,
    attachHintAsBlock: () => {},
  }), [])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open, setQuery, setSelectedIndex])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (controllerRef.current?.back?.()) {
        requestAnimationFrame(() => inputRef.current?.focus())
      } else {
        closeCommand()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, rankedItems.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const topFrame = controllerState?.frames[controllerState.frames.length - 1]
      if (topFrame?.kind === 'param-input') return
      if (topFrame?.kind === 'collect-input') {
        void controllerRef.current?.submitInput()
        return
      }
      if (topFrame?.kind === 'result') {
        const choice = topFrame.output.choices[Math.min(resultSelectedIndex, Math.max(0, topFrame.output.choices.length - 1))]
        if (choice) toggleResultChoice(choice, topFrame)
        return
      }
      const item = rankedItems[selectedIndex]
      if (item) {
        controllerRef.current?.selectItem(item)
      }
      return
    }
  }, [closeCommand, controllerRef, controllerState, rankedItems, resultSelectedIndex, selectedIndex, setSelectedIndex, toggleResultChoice])

  if (!open) return null

  const visibleItems = rankedItems.slice(0, 12)
  const topFrame = controllerState?.frames.length ? controllerState.frames[controllerState.frames.length - 1] : null
  const inControllerFrame = Boolean(topFrame && topFrame.kind !== 'list')

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: 'var(--color-background-primary, var(--panel, #fff))',
        borderRadius: 'inherit',
      }}
      onKeyDown={handleKeyDown}
    >
      {inControllerFrame ? (
        <GlobalLauncherFrameSwitch
          hostSurfaceTarget={null}
          hostSurfaceHeight={0}
          launcherSettingsTarget={null}
          settingsHeight={0}
          surfaceFrame={null}
          activeSurfaceFrame={null}
          itemPermissionFrame={null}
          controllerState={controllerState}
          inputRef={inputRef}
          query={query}
          searchPlaceholder="Run a command..."
          visibleFiltered={visibleItems}
          selectedItem={visibleItems[selectedIndex]}
          locale={locale}
          resultSelectedIndex={resultSelectedIndex}
          selectedResultChoiceIds={selectedResultChoiceIds}
          showCustomizeHint={false}
          showWorkflowObjectHint={false}
          customizeShortcutLabel="⌘↵"
          onSettingsClose={closeCommand}
          onSurfaceBack={closeCommand}
          onSurfaceClose={closeCommand}
          onPermissionBack={closeCommand}
          onPermissionGrant={() => {}}
          onParamQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
          onParamSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
          onParamCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
          onParamMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
          onFrameBack={() => {
            if (controllerRef.current?.back?.()) requestAnimationFrame(() => inputRef.current?.focus())
            else closeCommand()
          }}
          onCollectInputChange={(value) => controllerRef.current?.setInputText(value)}
          onActivateResultChoice={activateResultChoice}
          onHoverResultChoice={setResultSelectedIndex}
          onToggleResultChoice={toggleResultChoice}
          onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0) }}
          onSearchSelectItem={(item) => controllerRef.current?.selectItem(item)}
          onSearchHoverIndex={(index) => setSelectedIndex(index)}
          onSearchMouseMove={() => {}}
          clipboardBlock={emptyClipboardBlock}
        />
      ) : (
        <>
          <div
            className="flex items-center px-3 h-10 shrink-0 gap-2"
            style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
          >
            <span
              className="text-[10px] font-medium px-1 py-0.5 rounded shrink-0"
              style={{
                background: 'var(--color-background-tertiary)',
                color: 'var(--color-text-secondary)',
              }}
            >
              ⌘K
            </span>
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--color-text-primary)' }}
              placeholder="Run a command..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto py-1"
            data-launcher-scrollable
          >
            {visibleItems.length === 0 && query.trim().length > 0 && (
              <div
                className="px-3 py-4 text-center text-xs"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                No commands found
              </div>
            )}
            {visibleItems.map((item, index) => (
              <CommandOverlayItem
                key={item.systemKey}
                item={item}
                selected={index === selectedIndex}
                locale={locale}
                onSelect={() => controllerRef.current?.selectItem(item)}
                onHover={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CommandOverlayItem({
  item,
  selected,
  locale,
  onSelect,
  onHover,
}: {
  item: DomainLauncherItem
  selected: boolean
  locale: string
  onSelect: () => void
  onHover: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const title = resolveDisplayTitle(item.display, locale)
  const subtitle = resolveDisplaySubtitle(item.display, locale)
  const IconComponent = item.display.icon ? resolveIcon(item.display.icon) : null

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
      style={{
        background: selected ? 'var(--color-background-tertiary)' : 'transparent',
        color: 'var(--color-text-primary)',
      }}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      {IconComponent && (
        <span className="shrink-0 w-4 h-4 flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)' }}>
          <IconComponent size={14} />
        </span>
      )}
      <span className="text-sm truncate">{title}</span>
      {subtitle && (
        <span className="text-xs truncate ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
          {subtitle}
        </span>
      )}
    </button>
  )
}
