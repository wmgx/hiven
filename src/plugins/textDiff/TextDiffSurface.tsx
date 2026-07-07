import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { getPluginHostSdk } from '@hiven/plugin'
import { canUseSemanticJsonDiff } from './autoDiffMode'

type DiffMode = 'text' | 'json-semantic'
type JsonArrayMode = 'ordered' | 'unordered'

type DiffPayload = {
  original: { text?: string; title?: string }
  modified: { text?: string; title?: string }
}

function parsePayload(initialText?: string): DiffPayload {
  if (!initialText) return { original: { text: '' }, modified: { text: '' } }
  try {
    return JSON.parse(initialText) as DiffPayload
  } catch {
    return { original: { text: '' }, modified: { text: '' } }
  }
}

export function TextDiffSurface({ t, settings, host, initialText }: PluginSurfaceProps) {
  const { kits } = getPluginHostSdk()
  const { DualEditorView, diff } = kits

  const payload = useMemo(() => parsePayload(initialText), [initialText])
  const [originalText, setOriginalText] = useState(payload.original.text ?? '')
  const [modifiedText, setModifiedText] = useState(payload.modified.text ?? '')
  const [diffMode, setDiffMode] = useState<DiffMode>('text')
  const [jsonArrayMode, setJsonArrayMode] = useState<JsonArrayMode>('ordered')
  const [showJsonDropdown, setShowJsonDropdown] = useState(false)
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedOriginal, setDebouncedOriginal] = useState(originalText)
  const [debouncedModified, setDebouncedModified] = useState(modifiedText)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedOriginal(originalText)
      setDebouncedModified(modifiedText)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [originalText, modifiedText])

  const semanticAvailable = useMemo(
    () => canUseSemanticJsonDiff(debouncedOriginal, debouncedModified),
    [debouncedOriginal, debouncedModified],
  )

  const renderMode: DiffMode = diffMode === 'json-semantic' && semanticAvailable ? 'json-semantic' : 'text'

  const { leftText, rightText, leftHighlights, rightHighlights } = useMemo(() => {
    if (renderMode === 'json-semantic') {
      const origParsed = diff.parseJson(debouncedOriginal)
      const modParsed = diff.parseJson(debouncedModified)
      if (origParsed.ok && modParsed.ok && origParsed.value != null && modParsed.value != null) {
        const tree = diff.buildDiffTree(origParsed.value, modParsed.value)
        const leftLines = diff.buildSideLines(tree, 'left')
        const rightLines = diff.buildSideLines(tree, 'right')
        return {
          leftText: leftLines.map((line) => line.text).join('\n'),
          rightText: rightLines.map((line) => line.text).join('\n'),
          leftHighlights: leftLines.reduce<number[]>((acc, line, index) => {
            if (line.highlight) acc.push(index + 1)
            return acc
          }, []),
          rightHighlights: rightLines.reduce<number[]>((acc, line, index) => {
            if (line.highlight) acc.push(index + 1)
            return acc
          }, []),
        }
      }
    }

    const result = diff.computeTextLineDiff(debouncedOriginal, debouncedModified)
    return { leftText: debouncedOriginal, rightText: debouncedModified, ...result }
  }, [renderMode, debouncedOriginal, debouncedModified, diff])

  const hunkLines = useMemo(() => {
    const hunks: number[] = []
    const lines = leftHighlights.length > 0 ? leftHighlights : rightHighlights
    if (lines.length === 0) return hunks
    let lastLine = -999
    for (const line of lines) {
      if (line - lastLine > 1) hunks.push(line)
      lastLine = line
    }
    return hunks
  }, [leftHighlights, rightHighlights])

  const totalHunks = hunkLines.length

  useEffect(() => {
    if (currentHunkIndex >= totalHunks && totalHunks > 0) {
      setCurrentHunkIndex(totalHunks - 1)
    }
  }, [totalHunks, currentHunkIndex])

  const handleSwap = useCallback(() => {
    setOriginalText(modifiedText)
    setModifiedText(originalText)
  }, [originalText, modifiedText])

  const handleDetach = useCallback(() => {
    const payload = JSON.stringify({ original: { text: originalText }, modified: { text: modifiedText } })
    host.detachToWindow(payload)
  }, [originalText, modifiedText, host])

  const handlePrevHunk = useCallback(() => {
    if (totalHunks === 0) return
    setCurrentHunkIndex((i) => (i - 1 + totalHunks) % totalHunks)
  }, [totalHunks])

  const handleNextHunk = useCallback(() => {
    if (totalHunks === 0) return
    setCurrentHunkIndex((i) => (i + 1) % totalHunks)
  }, [totalHunks])

  const dropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showJsonDropdown) return
    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowJsonDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showJsonDropdown])

  const editorLanguage = renderMode === 'json-semantic' ? 'json' : 'plaintext'
  const hostSettings = settings as { fontSize?: number; lineNumbers?: boolean; wordWrap?: boolean; theme?: string }

  return (
    <div className="td-surface">
      {/* Header */}
      <div className="td-header">
        <div className="td-header-left">
          <div className="td-mode-toggle" role="radiogroup" aria-label={t('diff.mode')}>
            <button
              type="button"
              className={`td-mode-btn ${diffMode === 'text' ? 'is-active' : ''}`}
              onClick={() => setDiffMode('text')}
              aria-pressed={diffMode === 'text'}
            >
              {t('diff.textMode')}
            </button>
            <div className="td-json-mode-wrap" ref={dropdownRef}>
              <button
                type="button"
                className={`td-mode-btn td-mode-btn--json ${diffMode === 'json-semantic' ? 'is-active' : ''}`}
                onClick={() => {
                  setDiffMode('json-semantic')
                  if (diffMode === 'json-semantic') setShowJsonDropdown(!showJsonDropdown)
                }}
                aria-pressed={diffMode === 'json-semantic'}
              >
                <span>{t('diff.jsonSemantic')}</span>
                {diffMode === 'json-semantic' && (
                  <span className="td-badge">
                    {jsonArrayMode === 'ordered' ? t('diff.jsonSemanticBadge.ordered') : t('diff.jsonSemanticBadge.unordered')}
                  </span>
                )}
              </button>
              {showJsonDropdown && diffMode === 'json-semantic' && (
                <div className="td-dropdown">
                  <button
                    type="button"
                    className={`td-dropdown-item ${jsonArrayMode === 'ordered' ? 'is-active' : ''}`}
                    onClick={() => { setJsonArrayMode('ordered'); setShowJsonDropdown(false) }}
                  >
                    {t('diff.arrayOrdered')}
                  </button>
                  <button
                    type="button"
                    className={`td-dropdown-item ${jsonArrayMode === 'unordered' ? 'is-active' : ''}`}
                    onClick={() => { setJsonArrayMode('unordered'); setShowJsonDropdown(false) }}
                  >
                    {t('diff.arrayUnordered')}
                  </button>
                </div>
              )}
            </div>
          </div>
          {diffMode === 'json-semantic' && !semanticAvailable && (
            <span className="td-hint">{t('diff.semanticUnavailable')}</span>
          )}
        </div>
        <div className="td-header-right">
          <button type="button" className="td-action-btn" onClick={handleSwap} title={t('diff.swap')} aria-label={t('diff.swap')}>
            ⇄
          </button>
          <button type="button" className="td-action-btn" onClick={handleDetach} title={t('diff.detach')} aria-label={t('diff.detach')}>
            ⧉
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="td-body">
        <DualEditorView
          leftText={leftText}
          rightText={rightText}
          leftHighlights={leftHighlights}
          rightHighlights={rightHighlights}
          layout="side-by-side"
          language={editorLanguage}
          onLeftChange={setOriginalText}
          onRightChange={setModifiedText}
          fontSize={hostSettings.fontSize ?? 13}
          lineNumbers={hostSettings.lineNumbers ?? true}
          wordWrap={hostSettings.wordWrap ?? false}
          monacoTheme={hostSettings.theme === 'dark' ? 'flux-vscode-dark' : 'flux-vscode-light'}
        />
      </div>

      {/* Status bar */}
      <div className="td-statusbar">
        <button
          type="button"
          className="td-nav-btn"
          onClick={handlePrevHunk}
          disabled={totalHunks === 0}
          title={t('diff.navPrev')}
          aria-label={t('diff.navPrev')}
        >
          ‹
        </button>
        <span className="td-nav-position">
          {totalHunks > 0
            ? t('diff.navPosition', { current: String(currentHunkIndex + 1), total: String(totalHunks) })
            : t('diff.noChanges')}
        </span>
        <button
          type="button"
          className="td-nav-btn"
          onClick={handleNextHunk}
          disabled={totalHunks === 0}
          title={t('diff.navNext')}
          aria-label={t('diff.navNext')}
        >
          ›
        </button>
      </div>
    </div>
  )
}
