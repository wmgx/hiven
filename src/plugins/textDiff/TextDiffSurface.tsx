import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffSource, PluginSurfaceProps } from '@hiven/plugin'
import { getPluginHostSdk } from '@hiven/plugin'
import { canUseSemanticJsonDiff } from './autoDiffMode'
import { useDiffSourceText } from './useDiffSourceText'

type DiffMode = 'text' | 'json'

type DiffPayload = {
  original: DiffSource
  modified: DiffSource
}

function asDiffSource(side: Partial<DiffSource> | undefined, fallbackId: string): DiffSource {
  return {
    sourceId: typeof side?.sourceId === 'string' ? side.sourceId : fallbackId,
    kind: side?.kind === 'editor-pane' || side?.kind === 'clipboard' || side?.kind === 'empty'
      ? side.kind
      : side?.paneId
        ? 'editor-pane'
        : 'empty',
    paneId: typeof side?.paneId === 'string' ? side.paneId : undefined,
    origin: side?.origin === 'editor' || side?.origin === 'quick-editor' ? side.origin : undefined,
    title: typeof side?.title === 'string' ? side.title : '',
    language: typeof side?.language === 'string' ? side.language : undefined,
    text: typeof side?.text === 'string' ? side.text : '',
  }
}

function parsePayload(initialText?: string): DiffPayload {
  if (!initialText) {
    return {
      original: asDiffSource({ text: '' }, 'original'),
      modified: asDiffSource({ text: '' }, 'modified'),
    }
  }
  try {
    const parsed = JSON.parse(initialText) as { original?: Partial<DiffSource>; modified?: Partial<DiffSource> }
    return {
      original: asDiffSource(parsed.original, 'original'),
      modified: asDiffSource(parsed.modified, 'modified'),
    }
  } catch {
    return {
      original: asDiffSource({ text: '' }, 'original'),
      modified: asDiffSource({ text: '' }, 'modified'),
    }
  }
}

const IconBack = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m15 18-6-6 6-6" />
  </svg>
)

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

const IconFormat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h14" />
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

export function TextDiffSurface({ t, settings, host, initialText }: PluginSurfaceProps) {
  const { kits } = getPluginHostSdk()
  const { DualEditorView, diff } = kits

  const payload = useMemo(() => parsePayload(initialText), [initialText])
  const [originalText, setOriginalText] = useDiffSourceText(payload.original)
  const [modifiedText, setModifiedText] = useDiffSourceText(payload.modified)
  const [diffMode, setDiffMode] = useState<DiffMode>('text')
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

  const jsonAvailable = useMemo(
    () => canUseSemanticJsonDiff(debouncedOriginal, debouncedModified),
    [debouncedOriginal, debouncedModified],
  )

  const renderMode: DiffMode = diffMode === 'json' && jsonAvailable ? 'json' : 'text'

  const { leftText, rightText, leftHighlights, rightHighlights, leftRanges, rightRanges } = useMemo(() => {
    // JSON mode: keep user text as-is; structural changes → character-range blocks.
    if (renderMode === 'json') {
      const hl = diff.computeJsonLineHighlights(debouncedOriginal, debouncedModified)
      if (hl) {
        return {
          leftText: debouncedOriginal,
          rightText: debouncedModified,
          leftHighlights: hl.leftHighlights,
          rightHighlights: hl.rightHighlights,
          leftRanges: hl.leftRanges,
          rightRanges: hl.rightRanges,
        }
      }
    }

    const result = diff.computeTextLineDiff(debouncedOriginal, debouncedModified)
    return {
      leftText: debouncedOriginal,
      rightText: debouncedModified,
      ...result,
      leftRanges: undefined as undefined,
      rightRanges: undefined as undefined,
    }
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

  /** Pretty-print both sides without sorting keys; only rewrites parseable sides. */
  const handleFormat = useCallback(() => {
    const left = diff.formatJsonPreserveKeyOrder(originalText)
    const right = diff.formatJsonPreserveKeyOrder(modifiedText)
    if (left != null) setOriginalText(left)
    if (right != null) setModifiedText(right)
  }, [diff, originalText, modifiedText])

  const canFormat = useMemo(() => {
    if (diffMode !== 'json') return false
    return diff.parseJson(originalText).ok || diff.parseJson(modifiedText).ok
  }, [diff, diffMode, originalText, modifiedText])

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

  // Follow the user-selected mode (not only successful JSON parse) so Monaco
  // can offer JSON folding / syntax while editing toward valid JSON.
  const editorLanguage = diffMode === 'json' ? 'json' : 'plaintext'
  const hostSettings = settings as { fontSize?: number; lineNumbers?: boolean; wordWrap?: boolean; theme?: string }

  return (
    <div className="td-surface">
      {/* Header — breadcrumb left, mode center-right, actions right */}
      <div className="td-hdr">
        <button type="button" className="td-bc-back" onClick={() => host.requestBack()}>
          <IconBack /><span className="td-bc-root">hiven</span>
        </button>
        <span className="td-bc-sep">/</span>
        <span className="td-bc-cur">{t('surface.breadcrumb')}</span>
        <div className="td-hdr-c">
          <div className="td-mt" role="group" aria-label={t('diff.mode')}>
            <button
              type="button"
              className={`td-mt-i ${diffMode === 'text' ? 'on' : ''}`}
              onClick={() => setDiffMode('text')}
            >
              <IconText />{t('diff.textMode')}
            </button>
            <button
              type="button"
              className={`td-mt-i ${diffMode === 'json' ? 'on' : ''}`}
              onClick={() => setDiffMode('json')}
              title={!jsonAvailable && diffMode === 'json' ? t('diff.semanticUnavailable') : undefined}
            >
              <IconJson />{t('diff.jsonMode')}
            </button>
          </div>
        </div>
        <div className="td-hdr-a">
          {diffMode === 'json' && (
            <button
              type="button"
              className="td-ib"
              onClick={handleFormat}
              disabled={!canFormat}
              title={t('diff.formatHint')}
              aria-label={t('diff.format')}
            >
              <IconFormat />
            </button>
          )}
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
          leftRanges={leftRanges}
          rightRanges={rightRanges}
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

      {diffMode === 'json' && renderMode === 'text' && (
        <div className="td-fallback" role="status">
          <span className="td-fallback-dot" aria-hidden />
          {t('diff.fallbackToText')}
        </div>
      )}

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
