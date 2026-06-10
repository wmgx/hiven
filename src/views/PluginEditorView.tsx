import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { ArrowLeft, FileText, Folder, FolderTree, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { listPluginFiles, readPluginFile } from '../workspace/pluginRuntime'
import type { PluginFileTree } from '../workspace/pluginTypes'
import { getFluxMonacoTheme, registerFluxMonacoThemes } from '../utils/monacoTheme'

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
          className="tree-node flex items-center gap-2 rounded-md px-2 py-1.5"
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
      className={`tree-node w-full flex items-center gap-2 text-left rounded-md px-2 py-1.5 ${activeFile === node.path ? 'active' : ''}`}
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
  const theme = useAppStore((s) => s.settings.theme)
  const t = useT('pluginEditor')
  const [fileTree, setFileTree] = useState<PluginFileTree[]>([])
  const [activeFile, setActiveFile] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginEditor?.folderPath])

  if (!pluginEditor) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--color-text-tertiary)' }}>
        <FolderTree size={36} strokeWidth={1.5} />
        <span>{t('noSelection')}</span>
        <button className="scripts-btn" onClick={closePluginEditor}>{t('backToPlugins')}</button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="scripts-header px-4 py-3" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <button className="script-action-btn" title={t('back')} onClick={closePluginEditor}>
            <ArrowLeft size={14} />
          </button>
          <span className="scripts-title">{t('title')}</span>
          <span className="script-badge">{t('readOnly')}</span>
          <span className="truncate" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8em' }}>
            {pluginEditor.pluginId} · {pluginEditor.folderPath}
          </span>
        </div>
        <div className="scripts-header-actions">
          <button className="scripts-btn" onClick={refreshTree} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('reload')}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2" style={{ color: 'var(--color-error-text)', fontSize: '0.85em' }}>
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <aside className="file-tree w-64 shrink-0 overflow-auto p-2" style={{ borderRight: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
          <div className="flex items-center gap-1 mb-2 px-1" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75em' }}>
            <FolderTree size={12} /> {t('fileTree')}
          </div>
          {fileTree.length === 0 && !loading ? (
            <div className="px-2 py-1.5" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8em' }}>
              {t('noFiles')}
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
            beforeMount={registerFluxMonacoThemes}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'off',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly: true,
              renderLineHighlight: 'line',
              glyphMargin: false,
              lineDecorationsWidth: 8,
              lineNumbersMinChars: 3,
              padding: { top: 12, left: 8 },
              fontFamily: 'var(--font-mono)',
            }}
            theme={getFluxMonacoTheme(theme)}
          />
        </main>
      </div>
    </div>
  )
}
