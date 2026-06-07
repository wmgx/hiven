import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ChevronDown, Check, Copy, Eraser, FilePlus, PanelRightOpen, PinOff, Play, RotateCcw, Send } from 'lucide-react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { localized, useAppStore, type PaletteParamModel, type PinnedAction } from '../store'
import { t, type Locale } from '../i18n'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { applyEffects } from '../workspace/effectRunner'
import { runPinnedPluginCommandToPatch } from '../workspace/pinnedPluginCommandRunner.ts'
import { detectEditorLanguage } from '../workspace/languageDetector'
import type { CommandContribution, CommandParam } from '../workspace/pluginTypes'

type ControlParam = PaletteParamModel | CommandParam

function defaultParams(actionParams: { key: string; default?: unknown }[] | undefined): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const param of actionParams ?? []) {
    if (param.default !== undefined) params[param.key] = param.default
  }
  return params
}

function paramOptions(param: ControlParam): { label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }[] {
  const dynamicOptions = 'optionsFn' in param ? param.optionsFn?.() : undefined
  const options = dynamicOptions ?? param.options ?? []
  return options.map((option) => typeof option === 'string' ? { label: option, value: option } : option)
}

function isParamVisible(param: ControlParam, params: Record<string, unknown>): boolean {
  if (!('visibleWhen' in param) || !param.visibleWhen) return true
  return Object.entries(param.visibleWhen).every(([key, value]) => params[key] === value)
}

function normalizePanelV2Placement(placement?: string): 'bottom' | 'right' | 'left' {
  if (placement === 'bottom' || placement === 'right' || placement === 'left') return placement
  return 'right'
}

// Module-level map: tracks last auto-run input key per pinned action to avoid redundant runs on remount
const lastAutoRunKeyMap = new Map<string, string>()

function markPinnedOutputStale(pinned: PinnedAction): Partial<PinnedAction> {
  if (pinned.autoRun || !pinned.outputText || pinned.outputKind === 'error' || pinned.outputKind === 'stale') return {}
  return {
    outputKind: 'stale',
    lastError: undefined,
  }
}

export function PinnedRunnerView() {
  const activePinnedActionId = useAppStore((s) => s.activePinnedActionId)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const updatePinnedAction = useAppStore((s) => s.updatePinnedAction)
  const updatePinnedRuntime = useAppStore((s) => s.updatePinnedRuntime)
  const releasePinnedRuntime = useAppStore((s) => s.releasePinnedRuntime)
  const unpinAction = useAppStore((s) => s.unpinAction)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const pinnedRuntime = useAppStore((s) => activePinnedActionId ? s.pinnedRuntimes[activePinnedActionId] : undefined)
  const locale = useAppStore((s) => s.locale)
  const [running, setRunning] = useState(false)
  const runIdRef = useRef<string | null>(null)

  const isCurrentPinnedRun = (pinnedId: string, runId: string): boolean => {
    const runtime = useAppStore.getState().pinnedRuntimes[pinnedId]
    if (runIdRef.current !== runId) return false
    if (!runtime || runtime.pendingRunId !== runId) return false
    if (runtime.status === 'disposed' || runtime.status === 'disposing') return false
    return true
  }

  const pinned = pinnedActions.find((item) => item.id === activePinnedActionId)
  const pluginCommand = pinned
    ? pluginRegistry.resolveCommand(pinned.actionId, pinned.isDev ? 'dev' : 'production')
    : undefined
  const commandContribution: CommandContribution | undefined = pluginCommand?.contribution
  const actionParams = commandContribution?.params ?? []
  const customControls = commandContribution?.live?.controls
  const liveTrigger = commandContribution?.live?.live?.trigger ?? 'on-input'
  const params = useMemo(() => ({
    ...defaultParams(actionParams),
    ...(pinned?.params ?? {}),
  }), [actionParams, pinned?.params])
  const paramsFingerprint = useMemo(() => JSON.stringify(params), [params])

  const runPinnedAction = async () => {
    if (!pinned) return
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const startedAt = performance.now()
    runIdRef.current = runId
    setRunning(true)
    updatePinnedRuntime(pinned.id, { pendingRunId: runId, status: 'active' })
    try {
      if (!commandContribution) throw new Error(`Pinned plugin command "${pinned.actionId}" is not registered`)
      const nextPatch = await runPinnedPluginCommandToPatch({
        command: commandContribution,
        pinned,
        params,
        ownerPluginId: pluginCommand?.meta.pluginId,
        now: () => Date.now(),
        elapsedMs: () => performance.now() - startedAt,
      })
      if (!isCurrentPinnedRun(pinned.id, runId)) return
      updatePinnedAction(pinned.id, nextPatch)
    } catch (error) {
      if (!isCurrentPinnedRun(pinned.id, runId)) return
      const message = error instanceof Error ? error.message : String(error)
      updatePinnedAction(pinned.id, {
        outputText: message,
        outputKind: 'error',
        lastRunAt: Date.now(),
        lastDurationMs: Math.round(performance.now() - startedAt),
        lastError: message,
      })
    } finally {
      if (runIdRef.current === runId) {
        runIdRef.current = null
        setRunning(false)
        const runtime = useAppStore.getState().pinnedRuntimes[pinned.id]
        if (runtime && runtime.status !== 'disposed' && runtime.status !== 'disposing') {
          updatePinnedRuntime(pinned.id, { pendingRunId: undefined, status: 'active' })
        }
      }
    }
  }

  const canApplyOutput = !!pinned?.outputText && pinned.outputKind !== 'error' && pinned.outputKind !== 'stale'

  const updateInputText = (text: string) => {
    if (!pinned) return
    updatePinnedAction(pinned.id, {
      inputText: text,
      ...markPinnedOutputStale(pinned),
    })
  }

  const updateParams = (nextParams: Record<string, unknown>) => {
    if (!pinned) return
    updatePinnedAction(pinned.id, {
      params: nextParams,
      ...markPinnedOutputStale(pinned),
    })
  }

  const applyOutputToActivePane = () => {
    if (!pinned || !canApplyOutput) return
    applyEffects([{ type: 'text.replace', target: 'active-input', text: pinned.outputText }])
    setActiveView('editor')
  }

  const sendOutputToNewPane = () => {
    if (!pinned || !canApplyOutput) return
    applyEffects([{ type: 'pane.create', pane: { text: pinned.outputText, title: pinned.title }, focus: true }])
    setActiveView('editor')
  }

  const toggleControls = () => {
    if (!pinned) return
    const nextOpen = !pinned.controlsOpen
    updatePinnedAction(pinned.id, { controlsOpen: nextOpen })
    if (!customControls?.panelId) return
    applyEffects([nextOpen
      ? {
          type: 'panel.openV2',
          panelId: customControls.panelId,
          placement: normalizePanelV2Placement(customControls.placement),
          inputs: {
            pinnedId: pinned.id,
            actionId: pinned.actionId,
            inputText: pinned.inputText,
            params,
          },
          scope: { type: 'pinned-action', pinnedId: pinned.id },
          title: `${pinned.title} Controls`,
          ownerPluginId: pluginCommand?.meta.pluginId,
          _isDev: pinned.isDev,
        }
      : { type: 'panel.closeV2', panelId: customControls.panelId },
    ])
  }

  useEffect(() => {
    if (!pinned || !pinned.autoRun || !pinned.inputText || liveTrigger === 'on-blur') return
    const runKey = `${pinned.id}\0${pinned.inputText}\0${paramsFingerprint}`
    if (lastAutoRunKeyMap.get(pinned.id) === runKey) return
    const timer = window.setTimeout(() => {
      lastAutoRunKeyMap.set(pinned.id, runKey)
      void runPinnedAction()
    }, pinned.debounceMs)
    return () => window.clearTimeout(timer)
  }, [pinned?.id, pinned?.inputText, pinned?.autoRun, pinned?.debounceMs, paramsFingerprint, liveTrigger])

  if (!pinned) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--color-text-tertiary)' }}>
        <div className="scripts-title">{t(locale, 'pinned.title')}</div>
        <button className="scripts-btn" onClick={() => setActiveView('editor')}>{t(locale, 'pinned.backToEditor')}</button>
      </div>
    )
  }

  const statusText = running
    ? t(locale, 'pinned.status.running')
    : pinned.lastError
      ? t(locale, 'pinned.status.error', { ms: String(pinned.lastDurationMs ?? 0) })
      : pinned.lastRunAt
        ? t(locale, 'pinned.status.ready', { ms: String(pinned.lastDurationMs ?? 0) })
        : t(locale, 'pinned.status.idle')

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--color-background-primary)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
      >
        <div className="min-w-0 flex items-center gap-3">
          <div className="scripts-title truncate text-[14px]">{pinned.title}</div>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full"
            style={{
              background: running
                ? 'var(--color-accent-light)'
                : pinned.lastError
                  ? 'var(--color-error-bg)'
                  : pinned.lastRunAt
                    ? 'var(--color-success-bg)'
                    : 'var(--color-background-tertiary)',
              color: running
                ? 'var(--color-accent)'
                : pinned.lastError
                  ? 'var(--color-error-text)'
                  : pinned.lastRunAt
                    ? 'var(--color-success-text)'
                    : 'var(--color-text-tertiary)',
            }}
          >
            {statusText}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="pinned-auto-toggle">
            <input
              type="checkbox"
              checked={pinned.autoRun}
              onChange={(event) => updatePinnedAction(pinned.id, { autoRun: event.target.checked })}
            />
            <span>{t(locale, 'pinned.auto')}</span>
          </label>
          <button data-testid="pinned-runner-run-button" className="scripts-btn scripts-btn-primary" onClick={() => void runPinnedAction()} disabled={running || !commandContribution} title={t(locale, 'pinned.runNow')}>
            <Play size={13} />
            {t(locale, 'pinned.runNow')}
          </button>
          <div className="pinned-btn-divider" />
          <button className="pinned-labeled-btn" onClick={toggleControls} title={t(locale, 'pinned.controls')}>
            <PanelRightOpen size={14} />
            <span>{t(locale, 'pinned.controls')}</span>
          </button>
          <button className="pinned-labeled-btn" onClick={() => releasePinnedRuntime(pinned.id, 'manual')} title={t(locale, 'pinned.releaseRuntime')}>
            <RotateCcw size={14} />
            <span>{t(locale, 'pinned.releaseRuntime')}</span>
          </button>
          <button className="pinned-icon-btn pinned-icon-btn-danger" onClick={() => unpinAction(pinned.id)} title={t(locale, 'pinned.unpin')}>
            <PinOff size={15} />
          </button>
        </div>
      </div>

      {/* Input / Output Panels */}
      <div className="grid grid-cols-2 min-h-0 flex-1">
        <section className="flex flex-col min-w-0 min-h-0" style={{ borderRight: '1px solid var(--color-border-tertiary)' }}>
          <div className="pinned-panel-header">
            <span className="pinned-panel-label">{t(locale, 'pinned.input')}</span>
            <button data-testid="pinned-runner-clear-input" className="pinned-icon-btn" onClick={() => updateInputText('')} title={t(locale, 'pinned.clearInput')}>
              <Eraser size={14} />
            </button>
          </div>
          <div data-testid="pinned-runner-input-buffer" className="flex-1 min-h-0">
            <PinnedMonacoEditor
              pinnedId={pinned.id}
              value={pinned.inputText}
              onChange={updateInputText}
              readOnly={false}
              onBlur={() => {
                if (pinned.autoRun && pinned.inputText && liveTrigger === 'on-blur') void runPinnedAction()
              }}
            />
          </div>
        </section>

        <section className="flex flex-col min-w-0 min-h-0">
          <div className="pinned-panel-header">
            <span className="pinned-panel-label">{t(locale, 'pinned.output')}</span>
            <div className="flex items-center gap-1">
              <button data-testid="pinned-runner-copy-output" className="pinned-icon-btn" onClick={() => { if (pinned.outputText) void navigator.clipboard.writeText(pinned.outputText) }} title={t(locale, 'pinned.copyOutput')}>
                <Copy size={14} />
              </button>
              <button data-testid="pinned-runner-clear-output" className="pinned-icon-btn" onClick={() => updatePinnedAction(pinned.id, { outputText: '', outputKind: 'text', lastError: undefined })} title={t(locale, 'pinned.clearOutput')}>
                <Eraser size={14} />
              </button>
              <button className="pinned-labeled-btn" onClick={applyOutputToActivePane} disabled={!canApplyOutput} title={t(locale, 'pinned.applyOutput')}>
                <Send size={13} />
                <span>{t(locale, 'pinned.applyOutput')}</span>
              </button>
              <button className="pinned-labeled-btn" onClick={sendOutputToNewPane} disabled={!canApplyOutput} title={t(locale, 'pinned.sendNewPane')}>
                <FilePlus size={13} />
                <span>{t(locale, 'pinned.sendNewPane')}</span>
              </button>
            </div>
          </div>
          <div data-testid="pinned-runner-output-buffer" className="flex-1 min-h-0 overflow-auto">
            <PinnedMonacoEditor
              pinnedId={pinned.id}
              value={pinned.outputText || ''}
              readOnly={true}
            />
          </div>
        </section>
      </div>

      {/* Controls Panel */}
      {pinned.controlsOpen && !customControls?.panelId && (
        <PinnedActionControls
          pinned={pinned}
          params={params}
          actionParams={actionParams}
          locale={locale}
          onChange={updateParams}
        />
      )}
    </div>
  )
}

/** Monaco-based editor for pinned input/output with auto language detection */
function PinnedMonacoEditor({ pinnedId, value, onChange, readOnly, onBlur }: {
  pinnedId: string
  value: string
  onChange?: (text: string) => void
  readOnly: boolean
  onBlur?: () => void
}) {
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
  const isLocalChange = useRef(false)
  const prevPinnedIdRef = useRef(pinnedId)
  const settings = useAppStore((s) => s.settings)

  const detectedLang = useMemo(() => detectEditorLanguage(value, { allowShortStrongSignals: true }), [value])

  // When switching pinned actions: force-set content and language immediately
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!model || !editor) return
    if (prevPinnedIdRef.current !== pinnedId) {
      prevPinnedIdRef.current = pinnedId
      isLocalChange.current = false
      // Force full content replacement
      const currentValue = model.getValue()
      if (currentValue !== value) {
        model.setValue(value)
      }
      // Force language update
      const lang = detectEditorLanguage(value, { allowShortStrongSignals: true })
      if (model.getLanguageId() !== lang) {
        monaco.editor.setModelLanguage(model, lang)
      }
      editor.setScrollPosition({ scrollTop: 0 })
      return
    }
  }, [pinnedId, value])

  // Sync language when content changes (same pinned action)
  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!model) return
    if (model.getLanguageId() !== detectedLang) {
      monaco.editor.setModelLanguage(model, detectedLang)
    }
  }, [detectedLang])

  // For writable (input) editor: sync external value changes while preserving cursor
  useEffect(() => {
    if (readOnly) return
    if (prevPinnedIdRef.current !== pinnedId) return // handled by pinned switch effect
    const editor = editorRef.current
    if (!editor) return
    if (isLocalChange.current) {
      isLocalChange.current = false
      return
    }
    const model = editor.getModel()
    if (model && model.getValue() !== value) {
      editor.executeEdits('external', [{
        range: model.getFullModelRange(),
        text: value,
        forceMoveMarkers: false,
      }])
    }
  }, [value, readOnly, pinnedId])

  return (
    <Editor
      height="100%"
      defaultLanguage={detectedLang}
      {...(readOnly ? { value } : { defaultValue: value })}
      onChange={(v) => {
        if (!onChange) return
        isLocalChange.current = true
        onChange(v || '')
      }}
      onMount={(editor) => {
        editorRef.current = editor
        if (onBlur) {
          editor.onDidBlurEditorWidget(() => onBlur())
        }
      }}
      options={{
        readOnly,
        fontSize: settings.fontSize,
        lineNumbers: 'on',
        wordWrap: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        folding: detectedLang !== 'plaintext',
        glyphMargin: false,
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 3,
        padding: { top: 8 },
        fontFamily: 'var(--font-mono)',
        domReadOnly: readOnly,
      }}
      theme="vs"
    />
  )
}

function PinnedActionControls({ pinned, params, actionParams, locale, onChange }: { pinned: PinnedAction; params: Record<string, unknown>; actionParams: ControlParam[]; locale: Locale; onChange: (params: Record<string, unknown>) => void }) {
  const visibleParams = actionParams.filter((param) => isParamVisible(param, params))

  const updateParam = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value })
  }

  if (visibleParams.length === 0) {
    return (
      <div className="pinned-controls-empty">
        {t(locale, 'pinned.noControls', { title: pinned.title })}
      </div>
    )
  }

  return (
    <div className="pinned-controls-bar">
      {visibleParams.map((param) => {
        const label = localized(param.label, param.labelI18n, locale)
        const value = params[param.key]
        if (param.type === 'boolean') {
          return (
            <label key={param.key} className="pinned-control-item">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => updateParam(param.key, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          )
        }
        if (param.type === 'single-select') {
          return (
            <div key={param.key} className="pinned-control-item">
              <span className="pinned-control-label">{label}</span>
              <PinnedDropdown
                value={String(value ?? '')}
                options={paramOptions(param)}
                onChange={(v) => updateParam(param.key, v)}
                locale={locale}
              />
            </div>
          )
        }
        if (param.type === 'multi-select') {
          const selected = Array.isArray(value) ? value.map(String) : []
          return (
            <div key={param.key} className="pinned-control-item">
              <span className="pinned-control-label">{label}</span>
              <PinnedMultiSelect
                selected={selected}
                options={paramOptions(param)}
                onChange={(v) => updateParam(param.key, v)}
                locale={locale}
              />
            </div>
          )
        }
        if (param.type === 'number') {
          return (
            <label key={param.key} className="pinned-control-item">
              <span className="pinned-control-label">{label}</span>
              <input
                type="number"
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(event) => updateParam(param.key, event.target.value === '' ? undefined : Number(event.target.value))}
                className="pinned-input pinned-input-number"
              />
            </label>
          )
        }
        return (
          <label key={param.key} className="pinned-control-item">
            <span className="pinned-control-label">{label}</span>
            <input
              type="text"
              value={value === undefined || value === null ? '' : String(value)}
              onChange={(event) => updateParam(param.key, event.target.value)}
              className="pinned-input"
            />
          </label>
        )
      })}
    </div>
  )
}

/** Custom dropdown component to replace native <select> */
function PinnedDropdown({ value, options, onChange, locale }: {
  value: string
  options: { label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }[]
  onChange: (value: string) => void
  locale: Locale
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.value === value)
  const displayText = selectedLabel ? localized(selectedLabel.label, selectedLabel.labelI18n, locale) : value || '—'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="pinned-dropdown">
      <button type="button" className="pinned-dropdown-trigger" onClick={() => setOpen(!open)}>
        <span className="pinned-dropdown-value">{displayText}</span>
        <ChevronDown size={12} className={`pinned-dropdown-chevron ${open ? 'pinned-dropdown-chevron-open' : ''}`} />
      </button>
      {open && (
        <div className="pinned-dropdown-menu">
          {options.map((option) => {
            const label = localized(option.label, option.labelI18n, locale)
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`pinned-dropdown-item ${isSelected ? 'pinned-dropdown-item-active' : ''}`}
                onClick={() => { onChange(option.value); setOpen(false) }}
              >
                <span>{label}</span>
                {isSelected && <Check size={12} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Custom multi-select with chip/tag UI */
function PinnedMultiSelect({ selected, options, onChange, locale }: {
  selected: string[]
  options: { label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }[]
  onChange: (values: string[]) => void
  locale: Locale
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (val: string) => {
    const next = selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]
    onChange(next)
  }

  return (
    <div ref={ref} className="pinned-dropdown">
      <button type="button" className="pinned-dropdown-trigger" onClick={() => setOpen(!open)}>
        <span className="pinned-dropdown-value">
          {selected.length === 0 ? '—' : `${selected.length} selected`}
        </span>
        <ChevronDown size={12} className={`pinned-dropdown-chevron ${open ? 'pinned-dropdown-chevron-open' : ''}`} />
      </button>
      {open && (
        <div className="pinned-dropdown-menu">
          {options.map((option) => {
            const label = localized(option.label, option.labelI18n, locale)
            const isSelected = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                className={`pinned-dropdown-item ${isSelected ? 'pinned-dropdown-item-active' : ''}`}
                onClick={() => toggle(option.value)}
              >
                <span>{label}</span>
                {isSelected && <Check size={12} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
