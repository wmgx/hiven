import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { ArrowLeft, Copy, FileText, Folder, FolderTree, Play, RefreshCw, Save } from 'lucide-react'
import { localized, parseScriptToAction, useAppStore } from '../store'
import { t } from '../i18n'
import { listPluginFiles, readPluginFile, savePluginFile } from '../workspace/pluginRuntime'
import type { PluginDefinition, PluginFileTree } from '../workspace/pluginTypes'
import { loadCDN, loadDeps } from '../utils/cdnLoader'

function flattenFileTree(nodes: PluginFileTree[]): PluginFileTree[] {
  const result: PluginFileTree[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children?.length) {
      result.push(...flattenFileTree(node.children))
    }
  }
  return result
}

function languageForPath(path: string) {
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

function preferredFile(nodes: PluginFileTree[], requested?: string): string {
  const files = flattenFileTree(nodes).filter((node) => !node.isDir)
  if (requested && files.some((node) => node.path === requested)) return requested
  return files.find((node) => /\/index\.(js|ts|jsx|tsx|mjs)$/.test(node.path))?.path || files[0]?.path || ''
}

function parsePluginDefinitionSource(source: string): PluginDefinition | null {
  try {
    const definePlugin = (definition: PluginDefinition) => definition
    const effects = {
      replaceActiveText: (text: string) => ({ type: 'text.replace' as const, target: 'active-input' as const, text }),
      createPane: (text: string, title?: string) => ({ type: 'pane.create' as const, pane: { text, title }, focus: true }),
      status: (message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => ({ type: 'status.message' as const, level, message }),
    }
    const code = source
      .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
      .replace(/const\s+\{\s*definePlugin\s*,\s*effects\s*\}\s*=\s*globalThis\.FluxTextPlugin\s*;?/, '')
      .replace(/export\s+default\s+definePlugin\s*\(/, 'return definePlugin(')
      .replace(/export\s+default\s+/, 'return ')
    const value = new Function('definePlugin', 'effects', code)(definePlugin, effects)
    if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null
    return value as PluginDefinition
  } catch {
    return null
  }
}

function TreeNode({
  node,
  activeFile,
  onOpenFile,
  depth = 0,
}: {
  node: PluginFileTree
  activeFile: string
  onOpenFile: (path: string) => void
  depth?: number
}) {
  if (node.isDir) {
    return (
      <div>
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1.5"
          style={{
            paddingLeft: 8 + depth * 12,
            color: 'var(--color-text-tertiary)',
            fontSize: '0.78em',
          }}
        >
          <Folder size={12} />
          <span className="truncate">{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            activeFile={activeFile}
            onOpenFile={onOpenFile}
            depth={depth + 1}
          />
        ))}
      </div>
    )
  }

  return (
    <button
      className="w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5"
      style={{
        paddingLeft: 8 + depth * 12,
        color: activeFile === node.path ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        background: activeFile === node.path ? 'var(--color-accent-light)' : 'transparent',
        fontSize: '0.82em',
      }}
      onClick={() => onOpenFile(node.path)}
    >
      <FileText size={12} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export function PluginEditorView() {
  const pluginEditor = useAppStore((s) => s.pluginEditor)
  const closePluginEditor = useAppStore((s) => s.closePluginEditor)
  const locale = useAppStore((s) => s.locale)
  const readOnly = !!pluginEditor?.readOnly
  const [fileTree, setFileTree] = useState<PluginFileTree[]>([])
  const [activeFile, setActiveFile] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [debugInput, setDebugInput] = useState('hello fluxtext\nwrite plugins faster')
  const [debugOutput, setDebugOutput] = useState('')
  const [debugParams, setDebugParams] = useState<Record<string, unknown>>({})
  const [debugLogs, setDebugLogs] = useState<string[]>(['ready'])
  const [debugRunning, setDebugRunning] = useState(false)

  const debugPlugin = parsePluginDefinitionSource(content)
  const debugCommand = debugPlugin?.commands?.[0] ?? null
  const debugAction = debugCommand ? null : parseScriptToAction(content)
  const debugParamsDef = debugCommand?.params ?? debugAction?.params ?? []

  async function refreshTree() {
    if (!pluginEditor) return
    setLoading(true)
    setError('')
    try {
      const nextTree = await listPluginFiles(pluginEditor.folderPath)
      setFileTree(nextTree)
      const firstFile = preferredFile(nextTree, pluginEditor.activeFile)
      if (firstFile) {
        await openFile(firstFile)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function openFile(path: string) {
    setLoading(true)
    setError('')
    try {
      const text = await readPluginFile(path)
      setActiveFile(path)
      setContent(text)
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function saveActiveFile() {
    if (!activeFile || readOnly) return
    setLoading(true)
    setError('')
    try {
      await savePluginFile(activeFile, content)
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function runDebug() {
    setDebugRunning(true)
    setDebugLogs([`> run ${debugCommand?.id ?? debugAction?.name ?? activeFile.split('/').pop() ?? 'plugin'}`])
    setDebugOutput('')
    const started = performance.now()
    try {
      const plugin = parsePluginDefinitionSource(content)
      const command = plugin?.commands?.[0]
      if (command) {
        const result = await Promise.resolve(command.run({
          inputs: { input: { kind: 'text', text: debugInput } },
          params: debugParams,
        }))
        const elapsed = Math.round(performance.now() - started)
        const textEffect = result.effects.find((effect) => effect.type === 'text.replace')
        const createPaneEffect = result.effects.find((effect) => effect.type === 'pane.create')
        const statusEffect = result.effects.find((effect) => effect.type === 'status.message')
        const output = textEffect && 'text' in textEffect
          ? String(textEffect.text)
          : createPaneEffect && 'pane' in createPaneEffect
            ? String(createPaneEffect.pane.text ?? '')
            : statusEffect && 'message' in statusEffect
              ? String(statusEffect.message)
              : ''
        setDebugOutput(output)
        setDebugLogs((logs) => [...logs, `effects: ${result.effects.length}`, `done in ${elapsed}ms`])
        return
      }

      const action = parseScriptToAction(content)
      if (!action || typeof action.run !== 'function') {
        setDebugLogs((logs) => [...logs, t(locale, 'pluginEditor.unsupportedDebug')])
        return
      }
      const deps = await loadDeps(content)
      const result = await Promise.resolve(action.run({
        input: { text: debugInput },
        params: debugParams,
        readClipboard: async () => '',
        loadCDN,
        deps,
      }))
      const elapsed = Math.round(performance.now() - started)
      if (result && result.text !== undefined) {
        const text = String(result.text)
        setDebugOutput(text)
        setDebugLogs((logs) => [...logs, `output: ${text.split('\n').length} lines`, `done in ${elapsed}ms`])
      } else {
        setDebugLogs((logs) => [...logs, `run() returned no text`, `done in ${elapsed}ms`])
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDebugOutput(`Error: ${message}`)
      setDebugLogs((logs) => [...logs, message])
    } finally {
      setDebugRunning(false)
    }
  }

  function setDebugParam(key: string, value: unknown) {
    setDebugParams((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    void refreshTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginEditor?.folderPath])

  if (!pluginEditor) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--color-text-tertiary)' }}>
        <FolderTree size={36} strokeWidth={1.5} />
        <span>{t(locale, 'pluginEditor.noSelection')}</span>
        <button className="scripts-btn" onClick={closePluginEditor}>{t(locale, 'pluginEditor.backToPlugins')}</button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="scripts-header px-4 py-3" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <button className="script-action-btn" title={t(locale, 'pluginEditor.back')} onClick={closePluginEditor}>
            <ArrowLeft size={14} />
          </button>
          <span className="scripts-title">{t(locale, 'pluginEditor.title')}</span>
          <span className="script-badge">
            {readOnly
              ? t(locale, 'pluginEditor.readOnly')
              : pluginEditor.source === 'installed'
                ? t(locale, 'pluginEditor.installed')
                : t(locale, 'pluginEditor.devOnly')}
          </span>
          <span className="truncate" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8em' }}>
            {pluginEditor.pluginId} · {pluginEditor.folderPath}
          </span>
        </div>
        <div className="scripts-header-actions">
          <button className="scripts-btn" onClick={refreshTree} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t(locale, 'pluginEditor.reload')}
          </button>
          <button className="scripts-btn scripts-btn-primary" onClick={saveActiveFile} disabled={readOnly || !dirty || loading || !activeFile}>
            <Save size={14} /> {t(locale, 'pluginEditor.save')}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2" style={{ color: 'var(--color-error-text)', fontSize: '0.85em' }}>
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <aside className="w-64 shrink-0 overflow-auto p-2" style={{ borderRight: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
          <div className="flex items-center gap-1 mb-2 px-1" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75em' }}>
            <FolderTree size={12} /> {t(locale, 'pluginEditor.fileTree')}
          </div>
          {fileTree.length === 0 && !loading ? (
            <div className="px-2 py-1.5" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8em' }}>
              {t(locale, 'pluginEditor.noFiles')}
            </div>
          ) : (
            fileTree.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                activeFile={activeFile}
                onOpenFile={openFile}
              />
            ))
          )}
        </aside>
        <main className="flex-1 min-w-0 min-h-0">
          <Editor
            height="100%"
            language={languageForPath(activeFile)}
            value={content}
            onChange={(value) => {
              setContent(value ?? '')
              setDirty(true)
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'off',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly,
            }}
          />
        </main>
        <aside className="w-[min(320px,34vw)] shrink-0 flex flex-col overflow-hidden" style={{ borderLeft: '0.5px solid var(--color-border-tertiary)' }}>
          <div className="h-10 px-3 flex items-center gap-2 shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
            <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>{t(locale, 'pluginEditor.debug')}</span>
            <button
              className="scripts-btn scripts-btn-primary ml-auto"
              onClick={runDebug}
              disabled={debugRunning}
              style={{ height: 26, padding: '0 10px' }}
            >
              <Play size={12} /> {debugRunning ? t(locale, 'pluginEditor.running') : t(locale, 'pluginEditor.run')}
            </button>
          </div>

          <div className="shrink-0 p-2.5 flex flex-col gap-2" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'pluginEditor.params')}</div>
            {debugParamsDef.length === 0 ? (
              <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'pluginEditor.unsupportedDebug')}</div>
            ) : debugParamsDef.map((param) => {
              const paramValue = debugParams[param.key] ?? param.default ?? (param.type === 'boolean' ? false : '')
              return (
                <label key={param.key} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-[84px] shrink-0 truncate">{localized(param.label, param.labelI18n, locale)}</span>
                  {param.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={!!paramValue}
                      onChange={(event) => setDebugParam(param.key, event.target.checked)}
                    />
                  ) : param.type === 'single-select' ? (
                    <select
                      className="flex-1 min-w-0 bg-transparent rounded px-1 py-0.5"
                      style={{ border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-primary)' }}
                      value={String(paramValue)}
                      onChange={(event) => setDebugParam(param.key, event.target.value)}
                    >
                      {(param.options ?? []).map((option) => {
                        const normalized = typeof option === 'string' ? { label: option, value: option } : option
                        return <option key={normalized.value} value={normalized.value}>{localized(normalized.label, normalized.labelI18n, locale)}</option>
                      })}
                    </select>
                  ) : (
                    <input
                      className="flex-1 min-w-0 bg-transparent rounded px-1 py-0.5"
                      style={{ border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-primary)' }}
                      value={String(paramValue)}
                      onChange={(event) => setDebugParam(param.key, param.type === 'number' ? Number(event.target.value) : event.target.value)}
                    />
                  )}
                </label>
              )
            })}
          </div>

          <div className="flex-1 min-h-0 flex flex-col" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            <div className="h-8 px-3 flex items-center shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'pluginEditor.input')}</span>
            </div>
            <textarea
              className="flex-1 min-h-0 p-2.5 text-xs leading-5 resize-none bg-transparent border-none outline-none"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
              value={debugInput}
              onChange={(event) => setDebugInput(event.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="flex-1 min-h-0 flex flex-col" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
            <div className="h-8 px-3 flex items-center shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'pluginEditor.output')}</span>
              <button
                className="ml-auto w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center"
                title={t(locale, 'pluginEditor.copyOutput')}
                style={{ color: 'var(--color-text-tertiary)' }}
                onClick={() => { if (debugOutput) void navigator.clipboard.writeText(debugOutput) }}
              >
                <Copy size={12} />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-2.5 text-xs leading-5 overflow-auto whitespace-pre-wrap" style={{ color: debugOutput ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {debugOutput || t(locale, 'pluginEditor.runToSee')}
            </div>
          </div>

          <div className="h-28 shrink-0 flex flex-col">
            <div className="h-7 px-3 flex items-center shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'pluginEditor.console')}</span>
            </div>
            <div className="flex-1 p-2 text-[11px] leading-5 overflow-auto" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {debugLogs.map((log, index) => <div key={`${index}-${log}`}>{log}</div>)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
