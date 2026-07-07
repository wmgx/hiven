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

const IconText = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" />
  </svg>
)

const IconJson = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" />
    <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />
  </svg>
)

const IconSwap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" />
  </svg>
)

const IconDetach = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
)

const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
)

const IconUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m18 15-6-6-6 6" />
  </svg>
)

const IconDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

const IconListOrdered = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
  </svg>
)

const IconListUnordered = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 7h4l3 9 4-15 3 6h4" />
  </svg>
)

const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="td-ck">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

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
    const allLines = [...new Set([...leftHighlights, ...rightHighlights])].sort((a, b) => a - b)
    if (allLines.length === 0) return hunks
    let lastLine = -999
    for (const line of allLines) {
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
    const p = JSON.stringify({ original: { text: originalText }, modified: { text: modifiedText } })
    host.detachToWindow(p)
  }, [originalText, modifiedText, host])

  const handlePrevHunk = useCallback(() => {
    if (totalHunks === 0) return
    setCurrentHunkIndex((i) => (i - 1 + totalHunks) % totalHunks)
  }, [totalHunks])

  const handleNextHunk = useCallback(() => {
    if (totalHunks === 0) return
    setCurrentHunkIndex((i) => (i + 1) % totalHunks)
  }, [totalHunks])

  const jsonWrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showJsonDropdown) return
    const onClickOutside = (e: MouseEvent) => {
      if (jsonWrapRef.current && !jsonWrapRef.current.contains(e.target as Node)) {
        setShowJsonDropdown(false)
      }
    }
    document.addEventListener('click', onClickOutside)
    return () => document.removeEventListener('click', onClickOutside)
  }, [showJsonDropdown])

  const editorLanguage = renderMode === 'json-semantic' ? 'json' : 'plaintext'
  const hostSettings = settings as { fontSize?: number; lineNumbers?: boolean; wordWrap?: boolean; theme?: string }

  return (
    <div className="td-surface">
      {/* Header — matches .hdr from mockup */}
      <div className="td-hdr">
        <div className="td-hdr-c">
          <div className="td-mt">
            <button
              type="button"
              className={`td-mt-i ${diffMode === 'text' ? 'on' : ''}`}
              onClick={() => { setDiffMode('text'); setShowJsonDropdown(false) }}
            >
              <IconText />{t('diff.textMode')}
            </button>
            <div className="td-json-wrap" ref={jsonWrapRef}>
              <button
                type="button"
                className={`td-mt-i ${diffMode === 'json-semantic' ? 'on' : ''}`}
                onClick={() => {
                  if (diffMode === 'json-semantic') {
                    setShowJsonDropdown(!showJsonDropdown)
                  } else {
                    setDiffMode('json-semantic')
                    setShowJsonDropdown(true)
                  }
                }}
              >
                <IconJson />{t('diff.jsonSemantic')}
                {diffMode === 'json-semantic' && (
                  <span className="td-mode-badge">
                    {jsonArrayMode === 'ordered' ? t('diff.jsonSemanticBadge.ordered') : t('diff.jsonSemanticBadge.unordered')}
                  </span>
                )}
              </button>
              {showJsonDropdown && diffMode === 'json-semantic' && (
                <div className="td-dd">
                  <button
                    type="button"
                    className={`td-dd-i ${jsonArrayMode === 'ordered' ? 'on' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setJsonArrayMode('ordered'); setShowJsonDropdown(false) }}
                  >
                    <IconListOrdered />{t('diff.arrayOrdered')}<IconCheck />
                  </button>
                  <button
                    type="button"
                    className={`td-dd-i ${jsonArrayMode === 'unordered' ? 'on' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setJsonArrayMode('unordered'); setShowJsonDropdown(false) }}
                  >
                    <IconListUnordered />{t('diff.arrayUnordered')}<IconCheck />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="td-hdr-a">
          <button type="button" className="td-ib" onClick={handleSwap} title={t('diff.swap')} aria-label={t('diff.swap')}>
            <IconSwap />
          </button>
          <button type="button" className="td-ib" onClick={handleDetach} title={t('diff.detach')} aria-label={t('diff.detach')}>
            <IconDetach />
          </button>
          <button type="button" className="td-ib td-ib--close" onClick={() => host.close()} title={t('diff.close')} aria-label={t('diff.close')}>
            <IconClose />
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

      {/* Status bar — matches .sbar from mockup */}
      <div className="td-sbar">
        <div className="td-nav">
          <button
            type="button"
            className="td-nav-b"
            onClick={handlePrevHunk}
            disabled={totalHunks === 0}
            aria-label={t('diff.navPrev')}
          >
            <IconUp />{t('diff.navPrev')}
          </button>
          <span className="td-nav-p">
            {totalHunks > 0
              ? t('diff.navPosition', { current: String(currentHunkIndex + 1), total: String(totalHunks) })
              : t('diff.noChanges')}
          </span>
          <button
            type="button"
            className="td-nav-b"
            onClick={handleNextHunk}
            disabled={totalHunks === 0}
            aria-label={t('diff.navNext')}
          >
            {t('diff.navNext')}<IconDown />
          </button>
        </div>
      </div>
    </div>
  )
}
