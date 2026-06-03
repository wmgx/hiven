import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Eraser, FilePlus, PanelRightOpen, PinOff, Play, RotateCcw, Send } from 'lucide-react'
import { localized, useAppStore, type ActionContext, type ActionParam, type PinnedAction } from '../store'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import type { Locale } from '../i18n'

function defaultParams(actionParams: { key: string; default?: unknown }[] | undefined): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const param of actionParams ?? []) {
    if (param.default !== undefined) params[param.key] = param.default
  }
  return params
}

function paramOptions(param: ActionParam): { label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }[] {
  const options = param.optionsFn?.() ?? param.options ?? []
  return options.map((option) => typeof option === 'string' ? { label: option, value: option } : option)
}

function isParamVisible(param: ActionParam, params: Record<string, unknown>): boolean {
  if (!param.visibleWhen) return true
  return Object.entries(param.visibleWhen).every(([key, value]) => params[key] === value)
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
  const applyOutputToActivePane = useWorkspaceStore((s) => s.setActivePaneText)
  const createPane = useWorkspaceStore((s) => s.createPane)
  const [running, setRunning] = useState(false)
  const runIdRef = useRef<string | null>(null)

  const pinned = pinnedActions.find((item) => item.id === activePinnedActionId)
  const action = actions.find((item) => item.name === pinned?.actionId)
  const params = useMemo(() => ({
    ...defaultParams(action?.params),
    ...(pinned?.params ?? {}),
  }), [action?.params, pinned?.params])
  const paramsFingerprint = useMemo(() => JSON.stringify(params), [params])

  const runPinnedAction = async () => {
    if (!pinned || !action) return
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const startedAt = performance.now()
    runIdRef.current = runId
    setRunning(true)
    updatePinnedRuntime(pinned.id, { pendingRunId: runId, status: 'active' })
    try {
      const ctx: ActionContext = {
        input: { text: pinned.inputText },
        params,
        readClipboard: async () => navigator.clipboard?.readText?.() ?? '',
        loadCDN: async (url: string) => import(/* @vite-ignore */ url),
        deps: {},
      }
      const result = await Promise.resolve(action.run(ctx))
      if (runIdRef.current !== runId) return
      const text = result && 'text' in result ? result.text : ''
      updatePinnedAction(pinned.id, {
        outputText: text,
        outputKind: 'text',
        lastRunAt: Date.now(),
        lastDurationMs: Math.round(performance.now() - startedAt),
        lastError: undefined,
      })
    } catch (error) {
      if (runIdRef.current !== runId) return
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
        updatePinnedRuntime(pinned.id, { pendingRunId: undefined, status: 'active' })
      }
    }
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
          <button className="scripts-btn scripts-btn-primary" onClick={() => void runPinnedAction()} disabled={running || !action} title="Run Now">
            <Play size={14} />
            Run Now
          </button>
          <button className="scripts-btn" onClick={() => updatePinnedAction(pinned.id, { controlsOpen: !pinned.controlsOpen })} title="Open Controls">
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
            <button className="scripts-btn" onClick={() => updatePinnedAction(pinned.id, { inputText: '' })} title="Clear Input">
              <Eraser size={14} />
              Clear Input
            </button>
          </div>
          <textarea
            value={pinned.inputText}
            onChange={(event) => updatePinnedAction(pinned.id, { inputText: event.target.value })}
            spellCheck={false}
            className="flex-1 w-full resize-none outline-none border-none p-3 font-mono text-[13px]"
            style={{ background: 'var(--color-background-primary)', color: 'var(--color-text-primary)' }}
            placeholder="Input"
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
              <button className="scripts-btn" onClick={() => applyOutputToActivePane(pinned.outputText)} title="Apply Output to Active Pane">
                <Send size={14} />
                Apply
              </button>
              <button className="scripts-btn" onClick={() => createPane({ text: pinned.outputText, title: pinned.title, focus: true, direction: 'right' })} title="Send Output to New Pane">
                <FilePlus size={14} />
                Send New Pane
              </button>
            </div>
          </div>
          <textarea
            value={pinned.outputText}
            readOnly={true}
            spellCheck={false}
            className="flex-1 w-full resize-none outline-none border-none p-3 font-mono text-[13px]"
            style={{
              background: 'var(--color-background-secondary)',
              color: pinned.outputKind === 'error' ? 'var(--color-error-text)' : 'var(--color-text-primary)',
            }}
            placeholder="Output"
          />
        </section>
      </div>

      {pinned.controlsOpen && (
        <PinnedActionControls
          pinned={pinned}
          params={params}
          actionParams={action?.params ?? []}
          locale={useAppStore.getState().locale}
          onChange={(nextParams) => updatePinnedAction(pinned.id, { params: nextParams })}
        />
      )}
    </div>
  )
}

function PinnedActionControls({ pinned, params, actionParams, locale, onChange }: { pinned: PinnedAction; params: Record<string, unknown>; actionParams: ActionParam[]; locale: Locale; onChange: (params: Record<string, unknown>) => void }) {
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
