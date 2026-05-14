import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '../store'
import type { ActionDef } from '../store'
import { parseScriptToAction } from '../store'
import { t } from '../i18n'
import { AlertTriangle, Upload, Plus, Edit, Trash2, RefreshCw, Globe, X, Loader2, Search, Eye, Power, Download } from 'lucide-react'
import { resolveIcon } from '../utils/resolveIcon'
import { checkBuiltinScriptsUpdate } from '../configInit'

interface ScriptFile {
  name: string
  path: string
  content: string
  builtin?: boolean
  status?: 'loaded' | 'error'
  error?: string
}

function isTauri() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).__TAURI_INTERNALS__
}

function getParamDefault(type: string): string | boolean | number | unknown[] {
  switch (type) {
    case 'boolean': return false
    case 'number': return 0
    case 'multi-select': return []
    default: return ''
  }
}

let _tabIdCounter = 0
function nextTabId() { return `tab-${++_tabIdCounter}-${Date.now().toString(36)}` }

function generateScriptSource(action: import('../store').ActionDef): string {
  // 如果 source 已是完整脚本，直接返回
  if (action.source && /export\s+default/.test(action.source)) {
    return action.source
  }
  const lines: string[] = []
  if (action.source) {
    lines.push(action.source)
  }
  lines.push(`// ${action.name}.ts`)
  lines.push(`// ${action.title}${action.description ? ' — ' + action.description : ''}`)
  lines.push('')
  lines.push(`export default {`)
  lines.push(`  name: '${action.name}',`)
  lines.push(`  title: '${action.title}',`)
  if (action.titleI18n) {
    lines.push(`  titleI18n: ${JSON.stringify(action.titleI18n)},`)
  }
  if (action.icon) {
    lines.push(`  icon: '${action.icon}',`)
  }
  if (action.aliases?.length) {
    lines.push(`  aliases: [${action.aliases.map(a => `'${a}'`).join(', ')}],`)
  }
  if (action.description) {
    lines.push(`  description: '${action.description}',`)
  }
  if (action.descriptionI18n) {
    lines.push(`  descriptionI18n: ${JSON.stringify(action.descriptionI18n)},`)
  }
  if (action.tags?.length) {
    lines.push(`  tags: [${action.tags.map(t => `'${t}'`).join(', ')}],`)
  }
  if (action.params?.length) {
    const cleanParams = action.params.map(p => {
      const clean: Record<string, unknown> = { key: p.key, label: p.label, type: p.type }
      if (p.labelI18n) clean.labelI18n = p.labelI18n
      if (p.default !== undefined) clean.default = p.default
      if (p.options) {
        clean.options = p.options.map((o: string | { label: string; value: string; labelI18n?: any }) =>
          typeof o === 'string' ? o : (o.labelI18n ? { label: o.label, value: o.value, labelI18n: o.labelI18n } : { label: o.label, value: o.value })
        )
      }
      if (p.required) clean.required = true
      return clean
    })
    lines.push(`  params: ${JSON.stringify(cleanParams, null, 4).replace(/\n/g, '\n  ')},`)
  }
  if (action.run) {
    const runStr = action.run.toString()
    if (runStr.startsWith('run')) {
      lines.push(`  ${runStr},`)
    } else {
      lines.push(`  run: ${runStr},`)
    }
  }
  lines.push(`}`)
  return lines.join('\n')
}

/** 高亮搜索匹配文本 */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <span key={i} className="scripts-search-highlight">{part}</span>
          : part
      )}
    </>
  )
}

export function ScriptsView() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)
  const actions = useAppStore((s) => s.actions)
  const toggleBuiltinDisabled = useAppStore((s) => s.toggleBuiltinDisabled)
  const toggleCustomDisabled = useAppStore((s) => s.toggleCustomDisabled)
  const [customScripts, setCustomScripts] = useState<ScriptFile[]>([])
  const [loading, setLoading] = useState(false)
  const [showRemoteModal, setShowRemoteModal] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteImporting, setRemoteImporting] = useState(false)
  const [remoteError, setRemoteError] = useState('')

  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  // Tab
  const [activeTab, setActiveTab] = useState<'builtin' | 'custom'>('builtin')
  const tabsRef = useRef<HTMLDivElement>(null)
  const builtinTabRef = useRef<HTMLButtonElement>(null)
  const customTabRef = useRef<HTMLButtonElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  // 内置脚本更新检查
  const [scriptsCheckStatus, setScriptsCheckStatus] = useState<'idle' | 'checking' | 'updated' | 'up-to-date' | 'error'>('idle')
  const [scriptsNewVersion, setScriptsNewVersion] = useState(0)

  const handleCheckScriptsUpdate = async () => {
    setScriptsCheckStatus('checking')
    try {
      const result = await checkBuiltinScriptsUpdate()
      if (result.updated) {
        setScriptsCheckStatus('updated')
        setScriptsNewVersion(result.version || 0)
      } else {
        setScriptsCheckStatus(result.error ? 'error' : 'up-to-date')
      }
    } catch {
      setScriptsCheckStatus('error')
    }
  }

  const builtinActions = actions.filter((a) => a.builtin)

  // 更新 tab 指示条位置
  const updateIndicator = useCallback(() => {
    const container = tabsRef.current
    const btn = activeTab === 'builtin' ? builtinTabRef.current : customTabRef.current
    if (!container || !btn) return
    const containerRect = container.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    setIndicatorStyle({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    })
  }, [activeTab])

  useEffect(() => {
    updateIndicator()
  }, [updateIndicator])

  useEffect(() => {
    window.addEventListener('resize', updateIndicator)
    return () => window.removeEventListener('resize', updateIndicator)
  }, [updateIndicator])

  // 搜索过滤
  const trimmedQuery = searchQuery.trim().toLowerCase()
  const isSearching = trimmedQuery.length > 0

  const filteredBuiltin = useMemo(() => {
    if (!isSearching) return builtinActions
    return builtinActions.filter(a =>
      a.name.toLowerCase().includes(trimmedQuery) ||
      a.title.toLowerCase().includes(trimmedQuery) ||
      (a.titleI18n?.zh || '').toLowerCase().includes(trimmedQuery)
    )
  }, [builtinActions, trimmedQuery, isSearching])

  const filteredCustom = useMemo(() => {
    if (!isSearching) return customScripts
    return customScripts.filter(s =>
      s.name.toLowerCase().includes(trimmedQuery) ||
      s.path.toLowerCase().includes(trimmedQuery)
    )
  }, [customScripts, trimmedQuery, isSearching])

  const totalCount = isSearching
    ? filteredBuiltin.length + filteredCustom.length
    : builtinActions.length + customScripts.length

  function openScript(actionName: string) {
    const action = actions.find((a) => a.name === actionName)
    if (!action) return
    const script = generateScriptSource(action)
    const defaultParams: Record<string, string | boolean | number | unknown[]> = {}
    for (const p of action.params || []) {
      defaultParams[p.key] = p.default ?? getParamDefault(p.type)
    }
    useAppStore.getState().addDebuggerTab({
      id: nextTabId(),
      fileName: `${action.name}.ts`,
      script,
      input: '',
      output: '',
      params: defaultParams,
      consoleLogs: [{ type: 'dim', message: '— ready —' }],
      dirty: false,
      running: false,
      fileNameEditing: false,
      builtin: true,
    })
    setActiveView('debugger')
  }

  const loadScripts = useCallback(async () => {
    if (!isTauri()) return
    setLoading(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const scripts = await invoke<ScriptFile[]>('read_scripts_dir', { path: settings.watchDirectory })
      const userScripts = scripts.filter((s) => !s.builtin)
      setCustomScripts(userScripts.map((s) => {
        try {
          if (s.content.includes('export default') || s.content.includes('module.exports')) {
            return { ...s, status: 'loaded' as const }
          }
          return { ...s, status: 'loaded' as const }
        } catch {
          return { ...s, status: 'error' as const, error: 'Parse error' }
        }
      }))

      // 将自定义脚本注册到 Command Palette
      const customActions = userScripts
        .map(s => parseScriptToAction(s.content))
        .filter((a): a is ActionDef => a !== null)
      useAppStore.getState().setCustomActions(customActions)
    } catch (e) {
      console.error('Failed to load scripts:', e)
    }
    setLoading(false)
  }, [settings.watchDirectory])

  useEffect(() => {
    void loadScripts()
  }, [loadScripts])

  async function handleImport() {
    if (!isTauri()) {
      alert('Import requires Tauri desktop environment')
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { invoke } = await import('@tauri-apps/api/core')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')

      const selected = await open({
        title: 'Import Script',
        filters: [{ name: 'Scripts', extensions: ['js', 'ts'] }],
        multiple: true,
      })

      if (!selected) return
      const files = Array.isArray(selected) ? selected : [selected]

      for (const filePath of files) {
        const content = await readTextFile(filePath)
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'script.ts'
        const destPath = `${settings.watchDirectory}/${fileName}`
        await invoke('save_script', { path: destPath, content })
      }

      await loadScripts()
      setActiveTab('custom')
    } catch (e) {
      console.error('Import failed:', e)
    }
  }

  async function handleDelete(script: ScriptFile) {
    if (!isTauri()) return
    if (!confirm(`Delete ${script.name}?`)) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('delete_script', { path: script.path })
      await loadScripts()
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  function fileNameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const name = pathname.split('/').pop()
      if (name && /\.(js|ts)$/i.test(name)) return name
    } catch { /* ignore */ }
    return `remote_${Date.now()}.ts`
  }

  function isTxtUrl(url: string): boolean {
    try {
      return new URL(url).pathname.toLowerCase().endsWith('.txt')
    } catch { return false }
  }

  async function handleRemoteImport() {
    const url = remoteUrl.trim()
    if (!url) return
    if (!isTauri()) {
      alert('Import requires Tauri desktop environment')
      return
    }

    setRemoteImporting(true)
    setRemoteError('')

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const content = await invoke<string>('fetch_url', { url })

      let scriptUrls: string[]

      if (isTxtUrl(url)) {
        scriptUrls = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#') && /^https?:\/\//.test(line))
      } else {
        const fileName = fileNameFromUrl(url)
        const destPath = `${settings.watchDirectory}/${fileName}`
        await invoke('save_script', { path: destPath, content })
        await loadScripts()
        setShowRemoteModal(false)
        setRemoteUrl('')
        setRemoteImporting(false)
        setActiveTab('custom')
        return
      }

      if (scriptUrls.length === 0) {
        setRemoteError(t(locale, 'scripts.remoteImportError') + ': No valid URLs found in txt')
        setRemoteImporting(false)
        return
      }

      let successCount = 0
      for (const scriptUrl of scriptUrls) {
        try {
          const scriptContent = await invoke<string>('fetch_url', { url: scriptUrl })
          const fileName = fileNameFromUrl(scriptUrl)
          const destPath = `${settings.watchDirectory}/${fileName}`
          await invoke('save_script', { path: destPath, content: scriptContent })
          successCount++
        } catch (e) {
          console.error(`Failed to fetch ${scriptUrl}:`, e)
        }
      }

      await loadScripts()
      setShowRemoteModal(false)
      setRemoteUrl('')
      setActiveTab('custom')
      if (successCount === 0) {
        setRemoteError(t(locale, 'scripts.remoteImportError'))
      }
    } catch (e: unknown) {
      console.error('Remote import failed:', e)
      setRemoteError(`${t(locale, 'scripts.remoteImportError')}: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
    setRemoteImporting(false)
  }

  /** 渲染一张内置脚本卡片 */
  function renderBuiltinCard(action: typeof builtinActions[number], i: number) {
    const isDisabled = settings.disabledBuiltins.includes(action.name)
    return (
      <div
        key={action.name}
        className="script-card anim-card-in"
        style={{ animationDelay: `${i * 0.03}s`, opacity: isDisabled ? 0.5 : 1 }}
      >
        <div className="script-icon">
          {resolveIcon(action.icon, 16, action.name)}
        </div>
        <div className="script-info">
          <div className="script-name">
            <HighlightText text={action.name} query={trimmedQuery} />
          </div>
          <div className="script-desc">
            <HighlightText text={action.titleI18n?.zh || action.title} query={trimmedQuery} />
          </div>
        </div>
        <button
          onClick={() => openScript(action.name)}
          className="script-action-btn"
          title={t(locale, 'scripts.viewSource')}
        >
          <Eye size={14} />
        </button>
        <button
          onClick={() => toggleBuiltinDisabled(action.name)}
          className="script-action-btn"
          title={isDisabled ? t(locale, 'scripts.disabled') : t(locale, 'scripts.enabled')}
          style={{ color: isDisabled ? 'var(--color-error-text)' : 'var(--color-success-text)' }}
        >
          <Power size={14} />
        </button>
        <span className="script-badge">built-in</span>
      </div>
    )
  }

  /** 渲染一张自定义脚本卡片 */
  function renderCustomCard(s: ScriptFile, i: number) {
    const isDisabled = settings.disabledCustoms.includes(s.name)
    return (
      <div
        key={s.name}
        className="script-card anim-card-in"
        style={{
          animationDelay: `${i * 0.03}s`,
          borderColor: s.status === 'error' ? 'var(--color-error)' : undefined,
          opacity: isDisabled ? 0.5 : 1,
        }}
      >
        <div className="script-icon" style={s.status === 'error' ? {
          background: 'var(--color-error-bg)',
          color: 'var(--color-error-text)',
        } : undefined}>
          {s.status === 'error' ? <AlertTriangle size={16} /> : resolveIcon(undefined, 16, s.name)}
        </div>
        <div className="script-info">
          <div className="script-name">
            <HighlightText text={s.name} query={trimmedQuery} />
          </div>
          <div className="script-desc truncate">{s.error || s.path}</div>
        </div>
        <button
          onClick={() => {
            useAppStore.getState().addDebuggerTab({
              id: nextTabId(),
              fileName: s.name,
              script: s.content,
              input: '',
              output: '',
              params: {},
              consoleLogs: [{ type: 'dim', message: '— ready —' }],
              dirty: false,
              running: false,
              fileNameEditing: false,
            })
            setActiveView('debugger')
          }}
          className="script-action-btn"
          title="Edit"
        >
          <Edit size={14} />
        </button>
        <button
          onClick={() => handleDelete(s)}
          className="script-action-btn"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={() => toggleCustomDisabled(s.name)}
          className="script-action-btn"
          title={isDisabled ? t(locale, 'scripts.disabled') : t(locale, 'scripts.enabled')}
          style={{ color: isDisabled ? 'var(--color-error-text)' : 'var(--color-success-text)' }}
        >
          <Power size={14} />
        </button>
        <span
          className="script-badge"
          style={s.status === 'loaded' ? {
            background: 'var(--color-success-bg)',
            color: 'var(--color-success-text)',
          } : s.status === 'error' ? {
            background: 'var(--color-error-bg)',
            color: 'var(--color-error-text)',
          } : undefined}
        >
          {s.status}
        </span>
      </div>
    )
  }

  return (
    <div className="scripts-content">
      {/* Header */}
      <div className="scripts-header">
        <span className="scripts-title">{t(locale, 'scripts.title')}</span>
        <div className="scripts-header-actions">
          <button
            onClick={() => { setShowRemoteModal(true); setRemoteError('') }}
            className="scripts-btn"
          >
            <Globe size={14} /> {t(locale, 'scripts.remoteImport')}
          </button>
          <button onClick={handleImport} className="scripts-btn">
            <Upload size={14} /> {t(locale, 'scripts.import')}
          </button>
          <button
            onClick={() => {
              const demoScript = `export default {
  name: 'my-script',
  title: 'My Script',
  titleI18n: { zh: '我的脚本' },
  icon: 'Filter',                   // lucide 图标名，参考 https://lucide.dev/icons，不填则显示 name 前两个字母
  description: 'A demo script showing all available features',
  descriptionI18n: { zh: '展示所有可用功能的示例脚本' },
  tags: ['demo', 'template'],

  params: [
    {
      key: 'trim',
      label: 'Trim whitespace',
      labelI18n: { zh: '去除空白' },
      type: 'boolean',
      default: true,
    },
    {
      key: 'separator',
      label: 'Output separator',
      labelI18n: { zh: '输出分隔符' },
      type: 'single-select',
      options: [
        { label: 'Newline', value: 'newline', labelI18n: { zh: '换行' } },
        { label: 'Comma', value: 'comma', labelI18n: { zh: '逗号' } },
        { label: 'Tab', value: 'tab', labelI18n: { zh: '制表符' } },
      ],
      default: 'newline',
    },
  ],

  /**
   * run(ctx) — 脚本入口 / Script entry
   *
   * ctx.input.text   — 编辑器文本 / editor text (string)
   * ctx.params        — 用户参数 / user params (Record<string, any>)
   *
   * return { text }   — 写入输出面板 / write to output panel
   */
  run(ctx) {
    const lines = ctx.input.text.split('\\n')

    const processed = ctx.params.trim
      ? lines.map(line => line.trim()).filter(Boolean)
      : lines

    const sep = { newline: '\\n', comma: ', ', tab: '\\t' }[ctx.params.separator] || '\\n'

    return { text: processed.join(sep) }
  }
}
`
              useAppStore.getState().addDebuggerTab({
                id: nextTabId(),
                fileName: 'my-script.ts',
                script: demoScript,
                input: '',
                output: '',
                params: { trim: true, separator: 'newline' },
                consoleLogs: [{ type: 'dim', message: '— ready —' }],
                dirty: false,
                running: false,
                fileNameEditing: true,
              })
              setActiveView('debugger')
            }}
            className="scripts-btn scripts-btn-primary"
          >
            <Plus size={14} /> {t(locale, 'scripts.new')}
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="scripts-search-bar">
        <Search size={14} />
        <input
          className="scripts-search-input"
          type="text"
          placeholder={t(locale, 'scripts.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className={`scripts-search-count ${isSearching ? 'has-query' : ''}`}>
          {totalCount}
        </span>
      </div>

      {/* 搜索模式 — 平铺结果 */}
      {isSearching ? (
        <div className="scripts-search-results">
          {totalCount === 0 ? (
            <div className="scripts-empty">
              <Search size={40} strokeWidth={1.5} />
              <div className="scripts-empty-text">{t(locale, 'scripts.noResults')}</div>
            </div>
          ) : (
            <>
              {filteredBuiltin.map((a, i) => renderBuiltinCard(a, i))}
              {filteredCustom.map((s, i) => renderCustomCard(s, filteredBuiltin.length + i))}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="scripts-tabs" ref={tabsRef}>
            <button
              ref={builtinTabRef}
              className={`scripts-tab ${activeTab === 'builtin' ? 'active' : ''}`}
              onClick={() => setActiveTab('builtin')}
            >
              {t(locale, 'scripts.builtIn')}
              <span className={`scripts-tab-count ${activeTab === 'builtin' ? 'active' : ''}`}>
                {builtinActions.length}
              </span>
            </button>
            <button
              ref={customTabRef}
              className={`scripts-tab ${activeTab === 'custom' ? 'active' : ''}`}
              onClick={() => setActiveTab('custom')}
            >
              {t(locale, 'scripts.custom')}
              <span className={`scripts-tab-count ${activeTab === 'custom' ? 'active' : ''}`}>
                {customScripts.length}
              </span>
              {loading && <RefreshCw size={11} className="animate-spin" style={{ marginLeft: 4, color: 'var(--color-text-tertiary)' }} />}
            </button>
            <div
              className="scripts-tab-indicator"
              style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
            />
          </div>

          {/* Tab Panels — 滑动面板 */}
          <div className="scripts-tab-panels">
            <div
              className="scripts-tab-track"
              style={{ transform: activeTab === 'builtin' ? 'translateX(0)' : 'translateX(-50%)' }}
            >
              {/* Built-in Panel */}
              <div className="scripts-tab-panel">
                <div className="flex items-center justify-end gap-2 mb-2 px-1">
                  {scriptsCheckStatus === 'checking' ? (
                    <span className="flex items-center gap-1" style={{ fontSize: '0.75em', color: 'var(--color-text-tertiary)' }}>
                      <RefreshCw size={11} className="animate-spin" />
                      {t(locale, 'scripts.checkingUpdate')}
                    </span>
                  ) : scriptsCheckStatus === 'updated' ? (
                    <span className="flex items-center gap-1" style={{ fontSize: '0.75em', color: 'var(--color-success-text)' }}>
                      <Download size={11} />
                      {t(locale, 'scripts.scriptsUpdated').replace('{version}', String(scriptsNewVersion))}
                    </span>
                  ) : scriptsCheckStatus === 'up-to-date' ? (
                    <span style={{ fontSize: '0.75em', color: 'var(--color-text-tertiary)' }}>
                      {t(locale, 'scripts.scriptsUpToDate')}
                    </span>
                  ) : scriptsCheckStatus === 'error' ? (
                    <span style={{ fontSize: '0.75em', color: 'var(--color-error-text)' }}>
                      {t(locale, 'scripts.scriptsUpdateError')}
                    </span>
                  ) : null}
                  {scriptsCheckStatus !== 'checking' && (
                    <button
                      onClick={handleCheckScriptsUpdate}
                      className="scripts-btn"
                      style={{ fontSize: '0.75em', padding: '2px 8px' }}
                    >
                      <RefreshCw size={11} />
                      {t(locale, 'scripts.checkUpdate')}
                    </button>
                  )}
                </div>
                {builtinActions.map((a, i) => renderBuiltinCard(a, i))}
              </div>
              {/* Custom Panel */}
              <div className="scripts-tab-panel">
                {customScripts.length === 0 ? (
                  <div className="scripts-empty">
                    <Upload size={40} strokeWidth={1.5} />
                    <div className="scripts-empty-text">
                      {isTauri() ? 'No custom scripts found. Import or create one.' : 'Import requires Tauri desktop app.'}
                    </div>
                  </div>
                ) : (
                  customScripts.map((s, i) => renderCustomCard(s, i))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Remote Import Modal */}
      {showRemoteModal && (
        <div
          className="modal-overlay open"
          onClick={() => { if (!remoteImporting) setShowRemoteModal(false) }}
        >
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Upload size={16} />
                {t(locale, 'scripts.remoteImportTitle')}
              </div>
              <button
                onClick={() => { if (!remoteImporting) setShowRemoteModal(false) }}
                className="modal-close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-desc">
                {t(locale, 'scripts.remoteImportDesc')}
              </div>
              <div className="modal-url-row">
                <input
                  type="text"
                  className="modal-url-input"
                  value={remoteUrl}
                  onChange={(e) => { setRemoteUrl(e.target.value); setRemoteError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !remoteImporting) handleRemoteImport() }}
                  placeholder={t(locale, 'scripts.remoteImportPlaceholder')}
                  autoFocus
                  disabled={remoteImporting}
                />
                <button
                  onClick={handleRemoteImport}
                  disabled={remoteImporting || !remoteUrl.trim()}
                  className="scripts-btn scripts-btn-primary"
                  style={{ height: 36, padding: '0 16px', fontSize: 12 }}
                >
                  {remoteImporting ? <Loader2 size={12} className="animate-spin" /> : 'Fetch'}
                </button>
              </div>
              {remoteError && (
                <div className="mt-2 flex items-center gap-1" style={{ fontSize: '0.9em', color: 'var(--color-error-text, #ef4444)' }}>
                  <AlertTriangle size={12} /> {remoteError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                onClick={() => { setShowRemoteModal(false); setRemoteUrl('') }}
                disabled={remoteImporting}
                className="scripts-btn"
              >
                {t(locale, 'scripts.cancel')}
              </button>
              <button
                onClick={handleRemoteImport}
                disabled={remoteImporting || !remoteUrl.trim()}
                className="scripts-btn scripts-btn-primary"
              >
                {remoteImporting && <Loader2 size={12} className="animate-spin" />}
                {remoteImporting ? t(locale, 'scripts.remoteImporting') : t(locale, 'scripts.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
