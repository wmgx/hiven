/**
 * FluxText - Regex Tester Panel
 * Tests regex patterns against active pane text with live highlighting.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import type { PanelComponentProps } from '../workspace/panelRegistry'

interface MatchResult {
  index: number
  text: string
  groups: string[]
  line: number
  col: number
}

export function RegexTesterPanel({ instanceId, activePaneId, onClose }: PanelComponentProps) {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<MatchResult[]>([])
  const [pinned, setPinned] = useState(false)
  const [pinnedPaneId, setPinnedPaneId] = useState<string | null>(null)
  const decorationIdsRef = useRef<string[]>([])

  const targetPaneId = pinned && pinnedPaneId ? pinnedPaneId : activePaneId
  const paneText = useWorkspaceStore((s) => s.panes[targetPaneId]?.text || '')
  const paneTitle = useWorkspaceStore((s) => s.panes[targetPaneId]?.title || targetPaneId)

  // Clear decorations helper
  const clearDecorations = useCallback(() => {
    const editor = runtimeRegistry.getCodeEditor(targetPaneId)
    if (editor && decorationIdsRef.current.length > 0) {
      editor.deltaDecorations(decorationIdsRef.current, [])
      decorationIdsRef.current = []
    }
  }, [targetPaneId])

  // Apply regex and decorations
  useEffect(() => {
    if (!pattern) {
      clearDecorations()
      setMatches([])
      setError(null)
      return
    }

    let regex: RegExp
    try {
      regex = new RegExp(pattern, flags)
      setError(null)
    } catch (e: any) {
      setError(e.message)
      clearDecorations()
      setMatches([])
      return
    }

    // Find all matches
    const results: MatchResult[] = []
    const lines = paneText.split('\n')
    let globalOffset = 0

    // Use regex.exec for global matching
    if (flags.includes('g')) {
      let match: RegExpExecArray | null
      regex.lastIndex = 0
      while ((match = regex.exec(paneText)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++
          continue
        }
        // Calculate line/col
        const beforeMatch = paneText.slice(0, match.index)
        const lineNum = beforeMatch.split('\n').length
        const lastNewline = beforeMatch.lastIndexOf('\n')
        const col = match.index - lastNewline

        results.push({
          index: match.index,
          text: match[0],
          groups: match.slice(1),
          line: lineNum,
          col,
        })

        if (results.length > 1000) break // Safety limit
      }
    } else {
      const match = regex.exec(paneText)
      if (match) {
        const beforeMatch = paneText.slice(0, match.index)
        const lineNum = beforeMatch.split('\n').length
        const lastNewline = beforeMatch.lastIndexOf('\n')
        const col = match.index - lastNewline
        results.push({
          index: match.index,
          text: match[0],
          groups: match.slice(1),
          line: lineNum,
          col,
        })
      }
    }

    setMatches(results)

    // Apply Monaco decorations
    const editor = runtimeRegistry.getCodeEditor(targetPaneId)
    if (editor) {
      const model = editor.getModel()
      if (model) {
        const decorations = results.map((m) => {
          const startPos = model.getPositionAt(m.index)
          const endPos = model.getPositionAt(m.index + m.text.length)
          return {
            range: {
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            },
            options: {
              className: 'regex-match-highlight',
              overviewRuler: {
                color: '#fbbf24',
                position: 1, // Center
              },
              minimap: {
                color: '#fbbf24',
                position: 1,
              },
              inlineClassName: 'regex-match-inline',
            },
          }
        })

        decorationIdsRef.current = editor.deltaDecorations(
          decorationIdsRef.current,
          decorations
        )
      }
    }
  }, [pattern, flags, paneText, targetPaneId, clearDecorations])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearDecorations()
    }
  }, [clearDecorations])

  // Pin logic
  const handlePin = () => {
    if (!pinned) {
      setPinned(true)
      setPinnedPaneId(targetPaneId)
    } else {
      setPinned(false)
      setPinnedPaneId(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--color-background-primary)' }}>
      {/* Header */}
      <div
        className="h-[28px] flex items-center px-3 gap-2 shrink-0"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Regex Tester
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          · {paneTitle}
        </span>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 ml-1"
          style={{
            background: pinned ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
            color: pinned ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
          onClick={handlePin}
        >
          {pinned ? 'Pinned' : 'Pin'}
        </button>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {/* Input row */}
      <div className="flex items-center px-3 py-1.5 gap-2" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>/</span>
        <input
          className="flex-1 text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder="pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          autoFocus
        />
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>/</span>
        <input
          className="w-[40px] text-[12px] bg-transparent outline-none text-center"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder="flags"
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto px-3 py-1.5">
        {error && (
          <div className="text-[11px] py-1" style={{ color: 'var(--color-error-text)' }}>
            {error}
          </div>
        )}
        {!error && matches.length > 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ color: 'var(--color-success-text)' }}>{matches.length}</span> match{matches.length !== 1 ? 'es' : ''}
            {matches.slice(0, 20).map((m, i) => (
              <div key={i} className="flex gap-2 py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                <span className="shrink-0">{m.line}:{m.col}</span>
                <span className="truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {m.text.slice(0, 50)}{m.text.length > 50 ? '…' : ''}
                </span>
                {m.groups.length > 0 && (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    [{m.groups.map((g, j) => g || '∅').join(', ')}]
                  </span>
                )}
              </div>
            ))}
            {matches.length > 20 && (
              <div className="py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                ... and {matches.length - 20} more
              </div>
            )}
          </div>
        )}
        {!error && pattern && matches.length === 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            No matches
          </div>
        )}
      </div>

      {/* Inline style for highlighting */}
      <style>{`
        .regex-match-highlight {
          background-color: rgba(251, 191, 36, 0.25);
          border: 1px solid rgba(251, 191, 36, 0.6);
          border-radius: 2px;
        }
        .regex-match-inline {
          background-color: rgba(251, 191, 36, 0.25);
        }
      `}</style>
    </div>
  )
}
