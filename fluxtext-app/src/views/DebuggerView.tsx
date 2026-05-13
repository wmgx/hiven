import { useRef, useEffect, useState } from 'react'
import { useAppStore, localized } from '../store'
import { t } from '../i18n'
import Editor from '@monaco-editor/react'
import { Play, Save, Trash2, FileType, Copy, ChevronDown, Check, X } from 'lucide-react'

function isTauri() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).__TAURI_INTERNALS__
}

export function DebuggerView() {
  const debuggerScript = useAppStore((s) => s.debuggerScript)
  const setDebuggerScript = useAppStore((s) => s.setDebuggerScript)
  const debuggerInput = useAppStore((s) => s.debuggerInput)
  const setDebuggerInput = useAppStore((s) => s.setDebuggerInput)
  const debuggerOutput = useAppStore((s) => s.debuggerOutput)
  const setDebuggerOutput = useAppStore((s) => s.setDebuggerOutput)
  const debuggerParams = useAppStore((s) => s.debuggerParams)
  const setDebuggerParams = useAppStore((s) => s.setDebuggerParams)
  const consoleLogs = useAppStore((s) => s.consoleLogs)
  const addConsoleLog = useAppStore((s) => s.addConsoleLog)
  const clearConsoleLogs = useAppStore((s) => s.clearConsoleLogs)
  const debuggerFileName = useAppStore((s) => s.debuggerFileName)
  const setDebuggerFileName = useAppStore((s) => s.setDebuggerFileName)
  const debuggerDirty = useAppStore((s) => s.debuggerDirty)
  const setDebuggerDirty = useAppStore((s) => s.setDebuggerDirty)
  const debuggerRunning = useAppStore((s) => s.debuggerRunning)
  const setDebuggerRunning = useAppStore((s) => s.setDebuggerRunning)
  const debuggerFileNameEditing = useAppStore((s) => s.debuggerFileNameEditing)
  const setDebuggerFileNameEditing = useAppStore((s) => s.setDebuggerFileNameEditing)
  const debuggerTabs = useAppStore((s) => s.debuggerTabs)
  const activeDebuggerTabId = useAppStore((s) => s.activeDebuggerTabId)
  const switchDebuggerTab = useAppStore((s) => s.switchDebuggerTab)
  const removeDebuggerTab = useAppStore((s) => s.removeDebuggerTab)
  const locale = useAppStore((s) => s.locale)
  const actions = useAppStore((s) => s.actions)
  const settings = useAppStore((s) => s.settings)

  const [editingFileName, setEditingFileName] = useState(false)
  const [fileNameDraft, setFileNameDraft] = useState(debuggerFileName)
  const fileNameInputRef = useRef<HTMLInputElement>(null)

  // 切换 tab 时重置编辑状态
  useEffect(() => {
    setEditingFileName(false)
    setFileNameDraft(debuggerFileName)
  }, [activeDebuggerTabId, debuggerFileName])

  // 新建脚本时自动进入文件名编辑模式
  useEffect(() => {
    if (debuggerFileNameEditing) {
      setFileNameDraft(debuggerFileName)
      setEditingFileName(true)
      setDebuggerFileNameEditing(false)
    }
  }, [debuggerFileNameEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editingFileName && fileNameInputRef.current) {
      fileNameInputRef.current.focus()
      const dotIdx = fileNameDraft.lastIndexOf('.')
      fileNameInputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : fileNameDraft.length)
    }
  }, [editingFileName]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitFileName() {
    const name = fileNameDraft.trim()
    if (name && name !== debuggerFileName) {
      const finalName = /\.(ts|js)$/.test(name) ? name : name + '.ts'
      setDebuggerFileName(finalName)
      setFileNameDraft(finalName)
    } else {
      setFileNameDraft(debuggerFileName)
    }
    setEditingFileName(false)
  }

  const consoleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [consoleLogs])

  // 从 store 中匹配当前 debugger 对应的 action，获取其 params
  // 如果 action 未注册（如新建脚本），则从代码中解析 params
  const currentAction = actions.find(
    (a) => a.name === debuggerFileName.replace(/\.(ts|js)$/, '')
  )

  const parsedParams = (() => {
    if (currentAction?.params) return currentAction.params
    // 从脚本代码中解析 params 数组（支持嵌套 []）
    try {
      const startMatch = debuggerScript.match(/params\s*:\s*\[/)
      if (startMatch && startMatch.index !== undefined) {
        const startIdx = startMatch.index + startMatch[0].length - 1 // '[' 的位置
        let depth = 0
        let endIdx = -1
        for (let i = startIdx; i < debuggerScript.length; i++) {
          if (debuggerScript[i] === '[') depth++
          else if (debuggerScript[i] === ']') {
            depth--
            if (depth === 0) { endIdx = i; break }
          }
        }
        if (endIdx > startIdx) {
          const parsed = new Function(`return ${debuggerScript.substring(startIdx, endIdx + 1)}`)()
          if (Array.isArray(parsed)) return parsed
        }
      }
    } catch { /* ignore parse errors */ }
    return []
  })()

  function handleRun() {
    setDebuggerRunning(true)
    clearConsoleLogs()
    addConsoleLog({ type: 'dim', message: `> run ${debuggerFileName.replace('.ts', '')}` })
    addConsoleLog({ type: 'dim', message: `  params: ${JSON.stringify(debuggerParams)}` })
    addConsoleLog({ type: 'dim', message: `  input: ${debuggerInput.split('\n').length} lines` })

    setTimeout(() => {
      try {
        // Execute the extract-emails logic
        const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
        const allMatches = debuggerInput.match(re) || []
        const results = debuggerParams.unique
          ? [...new Set(allMatches.map((e: string) => e.toLowerCase()))]
          : allMatches
        const dupes = allMatches.length - results.length

        addConsoleLog({ type: 'ok', message: `✓ regex matched ${allMatches.length} address${allMatches.length !== 1 ? 'es' : ''}` })
        if (debuggerParams.unique && dupes > 0) {
          addConsoleLog({ type: 'ok', message: `✓ deduplicated → removed ${dupes} duplicate${dupes !== 1 ? 's' : ''}` })
        }
        addConsoleLog({ type: 'ok', message: `✓ output: ${results.length} address${results.length !== 1 ? 'es' : ''}` })
        addConsoleLog({ type: 'dim', message: `  done in ${Math.floor(Math.random() * 3) + 1}ms` })

        const outputText = debuggerParams.format === 'comma separated'
          ? results.join(', ')
          : results.join('\n')
        setDebuggerOutput(outputText)
      } catch (e: any) {
        addConsoleLog({ type: 'err', message: `✗ ${e.message}` })
        setDebuggerOutput(`Error: ${e.message}`)
      }
      setDebuggerRunning(false)
    }, 700)
  }

  async function handleSave() {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const destPath = `${settings.watchDirectory}/${debuggerFileName}`
        await invoke('save_script', { path: destPath, content: debuggerScript })
        addConsoleLog({ type: 'ok', message: `✓ saved ${debuggerFileName} → ${destPath}` })
      } catch (e: unknown) {
        addConsoleLog({ type: 'err', message: `✗ save failed: ${e instanceof Error ? e.message : e}` })
        return
      }
    } else {
      addConsoleLog({ type: 'ok', message: `✓ saved ${debuggerFileName} (in-memory only)` })
    }
    setDebuggerDirty(false)
  }

  function handleToggle(key: string) {
    setDebuggerParams({ ...debuggerParams, [key]: !debuggerParams[key] })
  }

  function handleSelect(key: string, value: string) {
    setDebuggerParams({ ...debuggerParams, [key]: value })
  }

  // Keyboard shortcut handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleRun()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [debuggerInput, debuggerParams])

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left column: Code + Console */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ borderRight: '0.5px solid var(--color-border-tertiary)' }}>
        {/* Tab bar */}
        <div
          className="flex items-center shrink-0"
          style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
        >
          <div className="flex items-center overflow-x-auto flex-1 min-w-0">
            {debuggerTabs.map(tab => {
              const isActive = tab.id === activeDebuggerTabId
              const name = isActive ? debuggerFileName : tab.fileName
              const isDirty = isActive ? debuggerDirty : tab.dirty
              return (
                <div
                  key={tab.id}
                  className="h-9 flex items-center gap-1.5 px-3 text-[11px] cursor-pointer shrink-0 group"
                  style={{
                    background: isActive ? 'var(--color-background-primary)' : 'transparent',
                    color: isActive ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
                    borderRight: '0.5px solid var(--color-border-tertiary)',
                  }}
                  onClick={() => { if (!isActive) switchDebuggerTab(tab.id) }}
                >
                  <FileType size={12} style={{ color: '#185FA5' }} />
                  {isActive && editingFileName ? (
                    <input
                      ref={fileNameInputRef}
                      className="text-[11px] bg-transparent border-none outline-none px-1 py-0.5 rounded"
                      style={{
                        color: 'var(--color-text-primary)',
                        background: 'var(--color-background-primary)',
                        border: '1px solid var(--color-accent)',
                        fontFamily: 'var(--font-mono)',
                        minWidth: 100,
                        maxWidth: 180,
                      }}
                      value={fileNameDraft}
                      onChange={(e) => setFileNameDraft(e.target.value)}
                      onBlur={commitFileName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitFileName()
                        if (e.key === 'Escape') { setFileNameDraft(debuggerFileName); setEditingFileName(false) }
                      }}
                    />
                  ) : (
                    <span
                      className="truncate max-w-[150px]"
                      style={{ fontFamily: 'var(--font-mono)' }}
                      onDoubleClick={(e) => {
                        if (isActive) {
                          e.stopPropagation()
                          setFileNameDraft(debuggerFileName)
                          setEditingFileName(true)
                        }
                      }}
                      title={isActive ? t(locale, 'debugger.dblClickRename') : name}
                    >
                      {name}
                    </span>
                  )}
                  {isDirty && <span style={{ color: 'var(--color-warning)', fontSize: '14px', lineHeight: 1 }}>●</span>}
                  {debuggerTabs.length > 1 && (
                    <button
                      className="w-4 h-4 rounded border-none bg-transparent cursor-pointer flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--color-text-tertiary)' }}
                      onClick={(e) => { e.stopPropagation(); removeDebuggerTab(tab.id) }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex gap-1 px-2 shrink-0">
            <button
              onClick={handleSave}
              className="w-7 h-7 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center"
              style={{ color: 'var(--color-text-tertiary)' }}
              title="Save (⌘S)"
            >
              <Save size={14} />
            </button>
            <button
              onClick={handleRun}
              disabled={debuggerRunning}
              className="h-[26px] px-2.5 rounded-md border-none cursor-pointer flex items-center gap-1.5 text-[11px]"
              style={{
                background: debuggerRunning ? 'var(--color-warning)' : 'var(--color-accent)',
                color: 'white',
              }}
            >
              <Play size={12} />
              {debuggerRunning ? t(locale, 'debugger.running') : t(locale, 'debugger.run')}
            </button>
          </div>
        </div>

        {/* Code editor */}
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="typescript"
            value={debuggerScript}
            onChange={(v) => setDebuggerScript(v || '')}
            onMount={(editor) => {
              editor.addAction({
                id: 'find-and-replace',
                label: 'Find and Replace',
                keybindings: [
                  2048 | 36,       // Cmd+F
                  2048 | 512 | 36, // Cmd+Option+F
                  2048 | 35,       // Cmd+H
                ],
                run: (ed) => {
                  ed.getAction('editor.action.startFindReplaceAction')?.run()
                },
              })
            }}
            options={{
              fontSize: settings.fontSize,
              lineNumbers: 'on',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'line',
              lineNumbersMinChars: 3,
              padding: { top: 10 },
              fontFamily: 'var(--font-mono)',
              tabSize: 2,
            }}
            theme="vs"
          />
        </div>

        {/* Console */}
        <div
          className="h-[120px] shrink-0 flex flex-col overflow-hidden"
          style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}
        >
          <div
            className="h-[30px] flex items-center px-3 gap-2 shrink-0"
            style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
          >
            <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{t(locale, 'debugger.console')}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded ml-auto"
              style={{
                background: debuggerRunning ? 'var(--color-warning-bg)' : consoleLogs.some(l => l.type === 'ok') ? 'var(--color-success-bg)' : 'var(--color-background-tertiary)',
                color: debuggerRunning ? '#633806' : consoleLogs.some(l => l.type === 'ok') ? 'var(--color-success-text)' : 'var(--color-text-tertiary)',
              }}
            >
              {debuggerRunning ? t(locale, 'debugger.running_status') : consoleLogs.some(l => l.type === 'ok') ? `${consoleLogs.filter(l => l.type === 'ok').length} ${t(locale, 'debugger.results')}` : t(locale, 'debugger.idle')}
            </span>
            <button
              onClick={clearConsoleLogs}
              className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={t(locale, 'debugger.clearConsole')}
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div ref={consoleRef} className="flex-1 overflow-y-auto px-3 py-1.5">
            {consoleLogs.map((log, i) => (
              <div
                key={i}
                className="text-[11px] leading-[18px] mb-px anim-console-line"
                style={{
                  animationDelay: `${i * 0.05}s`,
                  color: log.type === 'ok' ? 'var(--color-success)'
                    : log.type === 'err' ? 'var(--color-error)'
                    : log.type === 'warn' ? 'var(--color-warning)'
                    : 'var(--color-text-tertiary)',
                }}
              >
                {log.message}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right column: Params + Input + Output */}
      <div className="w-[min(280px,35vw)] shrink-0 flex flex-col overflow-hidden">
        {/* Params pane */}
        <div className="shrink-0 flex flex-col overflow-hidden" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <div
            className="h-8 flex items-center px-3 gap-2 shrink-0"
            style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
          >
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'debugger.params')}</span>
            <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'debugger.parsedFromCode')}</span>
          </div>
          <div className="p-2.5 flex flex-col gap-2.5 overflow-y-auto max-h-[200px]">
            {parsedParams.map((param) => {
              const paramValue = debuggerParams[param.key] ?? param.default ?? (param.type === 'boolean' ? false : '')
              return (
              <div key={param.key} className="flex items-center gap-2">
                <span className="text-[11px] w-[90px] shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{localized(param.label, param.labelI18n, locale)}</span>
                {param.type === 'boolean' ? (
                  <div
                    className="w-7 h-4 rounded-full relative cursor-pointer shrink-0"
                    style={{ background: paramValue ? 'var(--color-accent)' : 'var(--color-border-secondary)' }}
                    onClick={() => handleToggle(param.key)}
                  >
                    <div
                      className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150"
                      style={{ left: paramValue ? '14px' : '2px' }}
                    />
                  </div>
                ) : param.type === 'single-select' ? (
                  <CustomSelect
                    options={(param.options || []).map((o) =>
                      typeof o === 'string' ? o : { ...o, label: localized(o.label, o.labelI18n, locale) }
                    )}
                    value={debuggerParams[param.key] || ''}
                    onChange={(v) => handleSelect(param.key, v)}
                  />
                ) : null}
              </div>
              )
            })}
            {/* Snapshot */}
            <div className="pt-1 mt-1" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'debugger.paramsSnapshot')}</span>
              <pre className="text-[11px] mt-0.5 whitespace-pre-wrap break-all m-0" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {JSON.stringify(debuggerParams, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        {/* Input pane */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <div
            className="h-8 flex items-center px-3 shrink-0"
            style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
          >
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'debugger.input')} · ctx.input.text</span>
          </div>
          <textarea
            className="flex-1 p-2.5 text-xs leading-5 resize-none bg-transparent border-none outline-none overflow-auto"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
            value={debuggerInput}
            onChange={(e) => setDebuggerInput(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Output pane */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="h-8 flex items-center px-3 shrink-0"
            style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
          >
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'debugger.output')}</span>
            <button
              onClick={() => { if (debuggerOutput) navigator.clipboard.writeText(debuggerOutput) }}
              className="ml-auto w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center"
              style={{ color: 'var(--color-text-tertiary)' }}
              title={t(locale, 'debugger.copyOutput')}
            >
              <Copy size={12} />
            </button>
          </div>
          <div
            className="flex-1 p-2.5 text-xs leading-5 overflow-auto whitespace-pre-wrap"
            style={{
              color: debuggerOutput ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {debuggerOutput || t(locale, 'debugger.runToSee')}
          </div>
        </div>
      </div>
    </div>
  )
}

function CustomSelect({ options, value, onChange }: { options: (string | { label: string; value: string })[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const normalized = options.map((o) => typeof o === 'string' ? { label: o, value: o } : o)
  const selectedLabel = normalized.find((o) => o.value === value)?.label ?? value

  return (
    <div className="flex-1 relative min-w-0" ref={ref}>
      <div
        className="flex items-center justify-between text-[11px] px-2 py-1 rounded-md cursor-pointer"
        style={{
          background: 'var(--color-background-primary)',
          border: open ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-mono)',
        }}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, marginLeft: 4 }} />
      </div>
      {open && (
        <div
          className="absolute top-full mt-1 rounded-md overflow-hidden"
          style={{
            left: 0,
            minWidth: '100%',
            width: 'max-content',
            zIndex: 9999,
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-secondary)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          {normalized.map((opt) => (
            <div
              key={opt.value}
              className="flex items-center gap-2 text-[11px] px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
              style={{
                background: value === opt.value ? 'var(--color-accent-light)' : 'transparent',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
              }}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent-light)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = value === opt.value ? 'var(--color-accent-light)' : 'transparent' }}
            >
              <span className="w-3 shrink-0 flex items-center">
                {value === opt.value && <Check size={10} style={{ color: 'var(--color-accent)' }} />}
              </span>
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
