import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Eraser, FilePlus, PanelRightOpen, PinOff, Play, RotateCcw, Send } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { localized, useAppStore, type ActionContext, type ActionParam, type PinnedAction } from '../store'
import type { Locale } from '../i18n'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { applyEffects } from '../workspace/effectRunner'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { runTextPluginCommand } from '../workspace/pluginCommandRunner.ts'
import type { CommandContribution, CommandParam } from '../workspace/pluginTypes'

type ControlParam = ActionParam | CommandParam

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
  const actions = useAppStore((s) => s.actions)
  const updatePinnedAction = useAppStore((s) => s.updatePinnedAction)
  const updatePinnedRuntime = useAppStore((s) => s.updatePinnedRuntime)
  const releasePinnedRuntime = useAppStore((s) => s.releasePinnedRuntime)
  const unpinAction = useAppStore((s) => s.unpinAction)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const pinnedRuntime = useAppStore((s) => activePinnedActionId ? s.pinnedRuntimes[activePinnedActionId] : undefined)
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
  const action = (pinned?.kind ?? 'legacy') === 'legacy'
    ? actions.find((item) => item.name === pinned?.actionId)
    : undefined
  const pluginCommand = pinned?.kind === 'plugin-command'
    ? pluginRegistry.resolveCommand(pinned.actionId, pinned.isDev ? 'dev' : 'production')
    : undefined
  const commandContribution: CommandContribution | undefined = pluginCommand?.contribution
  const actionParams = action?.params ?? commandContribution?.params ?? []
  const customControls = commandContribution?.live?.controls
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
      let text = ''
      let outputKind: 'text' | 'error' = 'text'
      if ((pinned.kind ?? 'legacy') === 'legacy') {
        if (!action) throw new Error(`Pinned action "${pinned.actionId}" is not registered`)
        const ctx: ActionContext = {
          input: { text: pinned.inputText },
          params,
          readClipboard: async () => navigator.clipboard?.readText?.() ?? '',
          loadCDN: async (url: string) => import(/* @vite-ignore */ url),
          deps: {},
        }
        const result = await Promise.resolve(action.run(ctx))
        text = result && 'text' in result ? result.text : ''
      } else {
        if (!commandContribution) throw new Error(`Pinned plugin command "${pinned.actionId}" is not registered`)
        const output = await runTextPluginCommand(commandContribution, {
          inputText: pinned.inputText,
          params,
        })
        text = output.text
        outputKind = output.kind
      }
      if (!isCurrentPinnedRun(pinned.id, runId)) return
      updatePinnedAction(pinned.id, {
        outputText: text,
        outputKind,
        lastRunAt: Date.now(),
        lastDurationMs: Math.round(performance.now() - startedAt),
        lastError: undefined,
      })
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
  }

  const sendOutputToNewPane = () => {
    if (!pinned || !canApplyOutput) return
    applyEffects([{ type: 'pane.create', pane: { text: pinned.outputText, title: pinned.title }, focus: true }])
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
    if (!pinned || !pinned.autoRun || !pinned.inputText) return
    const timer = window.setTimeout(() => {
      void runPinnedAction()
    }, pinned.debounceMs)
    return () => window.clearTimeout(timer)
  }, [pinned?.id, pinned?.inputText, pinned?.autoRun, pinned?.debounceMs, paramsFingerprint])

  if (!pinned) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--color-text-tertiary)' }}>
        <div className="scripts-title">Pinned Actions</div>
        <button className="scripts-btn" onClick={() => setActiveView('editor')}>Back to Editor</button>
      </div>
    )
  }

  const statusText = running
    ? 'Running'
    : pinned.lastError
      ? `Error · ${pinned.lastDurationMs ?? 0}ms`
      : pinned.lastRunAt
        ? `Ready · ${pinned.lastDurationMs ?? 0}ms`
        : 'Ready'

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: 'var(--color-background-primary)' }}>
      <div
        className="h-12 flex items-center justify-between px-4 shrink-0"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
      >
        <div className="min-w-0">
          <div className="scripts-title truncate">{pinned.title}</div>
          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{statusText}</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <input
              type="checkbox"
              checked={pinned.autoRun}
              onChange={(event) => updatePinnedAction(pinned.id, { autoRun: event.target.checked })}
            />
            Auto
          </label>
          <button className="scripts-btn scripts-btn-primary" onClick={() => void runPinnedAction()} disabled={running || (!action && !commandContribution)} title="Run Now">
            <Play size={14} />
            Run Now
          </button>
          <button className="scripts-btn" onClick={toggleControls} title="Open Controls">
            <PanelRightOpen size={14} />
            Controls
          </button>
          <button className="scripts-btn" onClick={() => releasePinnedRuntime(pinned.id, 'manual')} title="Release runtime">
            <RotateCcw size={14} />
          </button>
          <button className="scripts-btn" onClick={() => unpinAction(pinned.id)} title="Unpin">
            <PinOff size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 min-h-0 flex-1">
        <section className="flex flex-col min-w-0 min-h-0" style={{ borderRight: '0.5px solid var(--color-border-tertiary)' }}>
          <div className="h-9 flex items-center justify-between px-3 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="text-[12px]">Input</span>
            <button className="scripts-btn" onClick={() => updateInputText('')} title="Clear Input">
              <Eraser size={14} />
              Clear Input
            </button>
          </div>
          <PinnedMonacoBuffer
            editorId={pinnedRuntime?.inputEditorId ?? `pinned-input-editor:${pinned.id}`}
            modelId={pinnedRuntime?.inputModelId ?? `pinned-input:${pinned.id}`}
            value={pinned.inputText}
            readOnly={false}
            onChange={updateInputText}
          />
        </section>

        <section className="flex flex-col min-w-0 min-h-0">
          <div className="h-9 flex items-center justify-between px-3 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="text-[12px]">Output</span>
            <div className="flex items-center gap-2">
              <button className="scripts-btn" onClick={() => { if (pinned.outputText) void navigator.clipboard.writeText(pinned.outputText) }} title="Copy Output">
                <Copy size={14} />
                Copy Output
              </button>
              <button className="scripts-btn" onClick={() => updatePinnedAction(pinned.id, { outputText: '', outputKind: 'text', lastError: undefined })} title="Clear Output">
                <Eraser size={14} />
                Clear Output
              </button>
              <button className="scripts-btn" onClick={applyOutputToActivePane} disabled={!canApplyOutput} title="Apply Output to Active Pane">
                <Send size={14} />
                Apply
              </button>
              <button className="scripts-btn" onClick={sendOutputToNewPane} disabled={!canApplyOutput} title="Send Output to New Pane">
                <FilePlus size={14} />
                Send New Pane
              </button>
            </div>
          </div>
          <PinnedMonacoBuffer
            editorId={pinnedRuntime?.outputEditorId ?? `pinned-output-editor:${pinned.id}`}
            modelId={pinnedRuntime?.outputModelId ?? `pinned-output:${pinned.id}`}
            value={pinned.outputText}
            readOnly={true}
            outputKind={pinned.outputKind}
          />
        </section>
      </div>

      {pinned.controlsOpen && !customControls?.panelId && (
        <PinnedActionControls
          pinned={pinned}
          params={params}
          actionParams={actionParams}
          locale={useAppStore.getState().locale}
          onChange={updateParams}
        />
      )}
    </div>
  )
}

function PinnedMonacoBuffer({
  editorId,
  modelId,
  value,
  readOnly,
  outputKind,
  onChange,
}: {
  editorId: string
  modelId: string
  value: string
  readOnly: boolean
  outputKind?: PinnedAction['outputKind']
  onChange?: (text: string) => void
}) {
  const settings = useAppStore((s) => s.settings)

  useEffect(() => {
    return () => {
      runtimeRegistry.unregisterCodeEditor(editorId)
    }
  }, [editorId])

  return (
    <div
      className="flex-1 min-h-0"
      style={{
        background: readOnly ? 'var(--color-background-secondary)' : 'var(--color-background-primary)',
        outline: outputKind === 'error'
          ? '1px solid var(--color-error-border)'
          : outputKind === 'stale'
            ? '1px solid var(--color-warning)'
            : undefined,
      }}
    >
      <Editor
        height="100%"
        path={modelId}
        language="plaintext"
        value={value}
        onChange={(nextValue) => {
          if (!readOnly) onChange?.(nextValue ?? '')
        }}
        onMount={(editor) => {
          runtimeRegistry.registerCodeEditor(editorId, editor)
        }}
        options={{
          readOnly,
          domReadOnly: readOnly,
          fontSize: settings.fontSize,
          lineNumbers: settings.lineNumbers ? 'on' : 'off',
          wordWrap: settings.wordWrap ? 'on' : 'off',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: readOnly ? 'none' : 'line',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          folding: false,
          stickyScroll: { enabled: false },
          glyphMargin: false,
          lineDecorationsWidth: 12,
          lineNumbersMinChars: 4,
          padding: { top: 12 },
          fontFamily: 'var(--font-mono)',
        }}
        theme="vs"
      />
    </div>
  )
}

function PinnedActionControls({ pinned, params, actionParams, locale, onChange }: { pinned: PinnedAction; params: Record<string, unknown>; actionParams: ControlParam[]; locale: Locale; onChange: (params: Record<string, unknown>) => void }) {
  const visibleParams = actionParams.filter((param) => isParamVisible(param, params))

  const updateParam = (key: string, value: unknown) => {
    onChange({ ...params, [key]: value })
  }

  if (visibleParams.length === 0) {
    return (
      <div className="min-h-10 flex items-center px-4 text-[12px] shrink-0" style={{ borderTop: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-tertiary)' }}>
        No controls for {pinned.title}
      </div>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 px-4 py-2 text-[12px] shrink-0"
      style={{ borderTop: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}
    >
      {visibleParams.map((param) => {
        const label = localized(param.label, param.labelI18n, locale)
        const value = params[param.key]
        if (param.type === 'boolean') {
          return (
            <label key={param.key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => updateParam(param.key, event.target.checked)}
              />
              {label}
            </label>
          )
        }
        if (param.type === 'single-select') {
          return (
            <label key={param.key} className="flex items-center gap-1.5">
              {label}
              <select
                value={String(value ?? '')}
                onChange={(event) => updateParam(param.key, event.target.value)}
                className="scripts-input h-7"
              >
                {paramOptions(param).map((option) => (
                  <option key={option.value} value={option.value}>
                    {localized(option.label, option.labelI18n, locale)}
                  </option>
                ))}
              </select>
            </label>
          )
        }
        if (param.type === 'multi-select') {
          const selected = Array.isArray(value) ? value.map(String) : []
          return (
            <label key={param.key} className="flex items-center gap-1.5">
              {label}
              <select
                multiple={true}
                value={selected}
                onChange={(event) => {
                  updateParam(param.key, Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
                }}
                className="scripts-input min-h-16"
              >
                {paramOptions(param).map((option) => (
                  <option key={option.value} value={option.value}>
                    {localized(option.label, option.labelI18n, locale)}
                  </option>
                ))}
              </select>
            </label>
          )
        }
        if (param.type === 'number') {
          return (
            <label key={param.key} className="flex items-center gap-1.5">
              {label}
              <input
                type="number"
                value={value === undefined || value === null ? '' : String(value)}
                onChange={(event) => updateParam(param.key, event.target.value === '' ? undefined : Number(event.target.value))}
                className="scripts-input h-7 w-24"
              />
            </label>
          )
        }
        return (
          <label key={param.key} className="flex items-center gap-1.5">
            {label}
            <input
              type="text"
              value={value === undefined || value === null ? '' : String(value)}
              onChange={(event) => updateParam(param.key, event.target.value)}
              className="scripts-input h-7 w-44"
            />
          </label>
        )
      })}
    </div>
  )
}
