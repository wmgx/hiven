import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, Menu, SegmentedControl, SurfaceHeaderActions } from '@hiven/plugin-ui'
import { getPluginDiffHost, type DiffSource } from '@hiven/plugin-diff'
import { DiffExplanation } from './DiffExplanation'
import { useDiffSourceText } from './useDiffSourceText'
import { createDiffSourceReader } from './sourceReadLifetime'
import { SetComparison } from './SetComparison'
import { buildHighlightNavigationTargets, clampDiffHunkIndex, moveDiffHunkIndex } from './diffNavigation'

type DiffMode = 'text' | 'json' | 'set'

type DiffPayload = {
  original: DiffSource
  modified: DiffSource
  sources?: DiffSource[]
  mode?: DiffMode
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
    const parsed = JSON.parse(initialText) as { original?: Partial<DiffSource>; modified?: Partial<DiffSource>; sources?: Partial<DiffSource>[]; mode?: DiffMode }
    return {
      mode: parsed.mode === 'text' || parsed.mode === 'json' || parsed.mode === 'set' ? parsed.mode : undefined,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map((source, i) => asDiffSource(source, String(i))) : [],
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

export function TextDiffSurface({ t, appearance, host, initialText }: PluginSurfaceProps) {
  // Diff kits are first-party only (@hiven/plugin-diff), not public PluginHostSdk.
  const { kits: diffKits } = getPluginDiffHost()
  const {
    DualEditorView,
    computeTextLineDiff,
    computeJsonLineHighlights,
    formatJsonPreserveKeyOrder,
    parseJson,
  } = diffKits

  const payload = useMemo(() => parsePayload(initialText), [initialText])
  const [originalSource, setOriginalSource] = useState(payload.original)
  const [modifiedSource, setModifiedSource] = useState(payload.modified)
  const [originalText, writeOriginalText] = useDiffSourceText(originalSource)
  const [modifiedText, writeModifiedText] = useDiffSourceText(modifiedSource)
  const currentTexts = useRef({ original: originalText, modified: modifiedText })
  currentTexts.current = { original: originalText, modified: modifiedText }
  const [originalReader] = useState(createDiffSourceReader)
  const [modifiedReader] = useState(createDiffSourceReader)
  const setOriginalText = useCallback((text: string) => {
    currentTexts.current.original = text
    originalReader.invalidate()
    writeOriginalText(text)
  }, [originalReader, writeOriginalText])
  const setModifiedText = useCallback((text: string) => {
    currentTexts.current.modified = text
    modifiedReader.invalidate()
    writeModifiedText(text)
  }, [modifiedReader, writeModifiedText])
  const invalidateSourceReads = useCallback(() => {
    originalReader.invalidate()
    modifiedReader.invalidate()
  }, [originalReader, modifiedReader])
  // Revoke existing reads without locking a hidden/reopened window or effect replay.
  useEffect(() => invalidateSourceReads, [invalidateSourceReads])
  const leaveSurface = invalidateSourceReads
  useLayoutEffect(() => host.subscribeLeaveIntent?.(leaveSurface), [host.subscribeLeaveIntent, leaveSurface])
  const [selectedMode, setDiffMode] = useState<DiffMode | undefined>(payload.mode)

  const sourceOptions = payload.sources?.length ? payload.sources : [
    asDiffSource({ sourceId: 'clipboard', kind: 'clipboard', title: t('choice.clipboard') }, 'clipboard'),
    asDiffSource({ sourceId: 'empty', kind: 'empty', title: t('source.empty') }, 'empty'),
  ]
  const [currentHunkIndex, setCurrentHunkIndex] = useState(0)
  const revealRequestId = useRef(0)
  const [lineRevealRequest, setLineRevealRequest] = useState<{
    requestId: number
    leftLine: number
    rightLine: number
  }>()

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

  const jsonPair = useMemo(() => [parseJson(debouncedOriginal), parseJson(debouncedModified)], [debouncedOriginal, debouncedModified, parseJson])
  const jsonAvailable = jsonPair.every(side => side.ok)

  const diffMode = selectedMode ?? (jsonAvailable ? 'json' : 'text')
  const renderMode: DiffMode = diffMode === 'set' ? 'set' : diffMode === 'json' && jsonAvailable ? 'json' : 'text'

  // Editors stay live (originalText/modifiedText); only highlights use the debounce snapshot.
  const { leftHighlights, rightHighlights, leftRanges, rightRanges, navigationHunks } = useMemo(() => {
    if (renderMode === 'set') return { leftHighlights: [], rightHighlights: [], leftRanges: undefined, rightRanges: undefined, navigationHunks: [] }
    const textResult = computeTextLineDiff(debouncedOriginal, debouncedModified)
    // JSON mode: keep user text as-is; structural changes → character-range blocks.
    if (renderMode === 'json') {
      const hl = computeJsonLineHighlights(debouncedOriginal, debouncedModified)
      if (hl) {
        return {
          leftHighlights: hl.leftHighlights,
          rightHighlights: hl.rightHighlights,
          leftRanges: hl.leftRanges,
          rightRanges: hl.rightRanges,
          navigationHunks: buildHighlightNavigationTargets(
            hl.leftHighlights,
            hl.rightHighlights,
            debouncedOriginal.split('\n').length,
            debouncedModified.split('\n').length,
          ),
        }
      }
    }

    return {
      leftHighlights: textResult.leftHighlights,
      rightHighlights: textResult.rightHighlights,
      leftRanges: undefined as undefined,
      rightRanges: undefined as undefined,
      navigationHunks: textResult.hunks,
    }
  }, [renderMode, debouncedOriginal, debouncedModified, computeJsonLineHighlights, computeTextLineDiff])

  const totalHunks = navigationHunks.length
  const displayedHunkIndex = clampDiffHunkIndex(currentHunkIndex, totalHunks)

  const handleSwap = useCallback(() => {
    setOriginalText(modifiedText)
    setModifiedText(originalText)
  }, [originalText, modifiedText, setOriginalText, setModifiedText])

  /** Pretty-print both sides without sorting keys; only rewrites parseable sides. */
  const handleFormat = useCallback(() => {
    const { original, modified } = currentTexts.current
    const left = formatJsonPreserveKeyOrder(original)
    const right = formatJsonPreserveKeyOrder(modified)
    if (left != null) setOriginalText(left)
    if (right != null) setModifiedText(right)
  }, [formatJsonPreserveKeyOrder, setOriginalText, setModifiedText])

  const canFormat = useMemo(() => {
    if (diffMode !== 'json') return false
    return jsonPair.some(side => side.ok)
  }, [jsonPair, diffMode])

  const handleDetach = useCallback(() => {
    leaveSurface()
    const snapshot = (source: DiffSource, text: string) => ({ sourceId: source.sourceId, kind: 'empty', title: source.title, language: source.language, text })
    const p = JSON.stringify({ original: snapshot(originalSource, originalText), modified: snapshot(modifiedSource, modifiedText), mode: diffMode })
    host.detachToWindow(p)
  }, [originalText, modifiedText, originalSource, modifiedSource, diffMode, host, leaveSurface])

  const navigateHunk = useCallback((direction: -1 | 1) => {
    const nextIndex = moveDiffHunkIndex(displayedHunkIndex, navigationHunks.length, direction)
    if (nextIndex == null) return
    const target = navigationHunks[nextIndex]
    setCurrentHunkIndex(nextIndex)
    setLineRevealRequest({
      requestId: ++revealRequestId.current,
      leftLine: target.leftLine,
      rightLine: target.rightLine,
    })
  }, [displayedHunkIndex, navigationHunks])

  // Follow the user-selected mode (not only successful JSON parse) so Monaco
  // can offer JSON folding / syntax while editing toward valid JSON.
  const editorLanguage = diffMode === 'json' ? 'json' : 'plaintext'
  return (
    <div className="td-surface">
      <div className="td-hdr">
        <div className="td-hdr-c">
          <SegmentedControl aria-label={t('diff.mode')} value={diffMode}
            options={(['text', 'json', 'set'] as const).map(value => ({ value, label: t(`diff.${value}Mode`) }))}
            onChange={value => setDiffMode(value as DiffMode)} />
        </div>
        <DiffExplanation host={host} t={t} original={originalText} modified={modifiedText} />
      </div>
      <SurfaceHeaderActions>
          {diffMode === 'json' && (
            <IconButton
              type="button"
              className="td-ib"
              onClick={handleFormat}
              disabled={!canFormat}
              title={t('diff.formatHint')}
              aria-label={t('diff.format')}
            >
              <IconFormat />
            </IconButton>
          )}
          <IconButton type="button" className="td-ib" onClick={handleSwap} title={t('diff.swap')} aria-label={t('diff.swap')}>
            <IconSwap />
          </IconButton>
          <IconButton type="button" className="td-ib" onClick={handleDetach} title={t('diff.detach')} aria-label={t('diff.detach')}>
            <IconDetach />
          </IconButton>
      </SurfaceHeaderActions>

      <div className="td-pane-labels">
        {([
          ['original', originalSource, setOriginalSource, originalReader],
          ['modified', modifiedSource, setModifiedSource, modifiedReader],
        ] as const).map(([side, source, setSource, reader]) => (
          <div className="td-pane-label" key={side}>
            <span>{t(`surface.${side}`)}</span>
            <Menu
              header={t('source.snapshotHint')}
              trigger={<Button variant="ghost" type="button" className="td-source" aria-label={t('source.choose', { side: t(`surface.${side}`) })}>{source.title || t('source.chooseShort')} ▾</Button>}
              items={sourceOptions.map((option) => ({
                key: option.sourceId,
                label: option.kind === 'empty' ? t('source.empty') : option.title,
                description: option.kind === 'editor-pane' ? t('source.paneDescription', {
                  language: !option.language || option.language === 'plaintext' ? t('source.plainText') : option.language,
                  lines: option.text ? option.text.split(/\r\n|\r|\n/).length : 0,
                  chars: option.text?.length ?? 0,
                }) : undefined,
                onSelect: () => {
                  void reader.select(option, () => host.clipboard.readText(), setSource,
                    () => host.showToast(t('source.readFailed'), 'error'))
                },
              }))}
            />
          </div>
        ))}
      </div>

      {/* Editor body */}
      <div className="td-body">
        <DualEditorView
          leftText={originalText}
          rightText={modifiedText}
          leftHighlights={leftHighlights}
          rightHighlights={rightHighlights}
          leftRanges={leftRanges}
          rightRanges={rightRanges}
          lineRevealRequest={lineRevealRequest}
          layout="side-by-side"
          language={editorLanguage}
          onLeftChange={setOriginalText}
          onRightChange={setModifiedText}
          fontSize={appearance.fontSize}
          lineNumbers={appearance.lineNumbers}
          wordWrap={appearance.wordWrap}
          monacoTheme={appearance.theme === 'dark' ? 'flux-vscode-dark' : 'flux-vscode-light'}
          onLeftReady={(editor) => {
            const input = editor.getDomNode()?.querySelector('[role="textbox"]')
            input?.setAttribute('data-plugin-surface-autofocus', '')
            return () => input?.removeAttribute('data-plugin-surface-autofocus')
          }}
          leftAriaLabel={t('surface.original')}
          rightAriaLabel={t('surface.modified')}
        />
      </div>

      {diffMode === 'set' && <SetComparison host={host} t={t} left={originalText} right={modifiedText} />}

      {diffMode === 'json' && renderMode === 'text' && (
        <div className="td-fallback" role="status">
          <span className="td-fallback-dot" aria-hidden />
          {t('diff.fallbackToText')}
        </div>
      )}

      {/* Status bar — matches .sbar from mockup */}
      {diffMode !== 'set' && <div className="td-sbar">
        <div className="td-nav">
          <Button variant="ghost"
            type="button"
            className="td-nav-b"
            onClick={() => navigateHunk(-1)}
            disabled={totalHunks === 0}
            aria-label={t('diff.navPrev')}
          >
            <IconUp />{t('diff.navPrev')}
          </Button>
          <span className="td-nav-p">
            {totalHunks > 0
              ? t('diff.navPosition', { current: String(displayedHunkIndex + 1), total: String(totalHunks) })
              : t('diff.noChanges')}
          </span>
          <Button variant="ghost"
            type="button"
            className="td-nav-b"
            onClick={() => navigateHunk(1)}
            disabled={totalHunks === 0}
            aria-label={t('diff.navNext')}
          >
            {t('diff.navNext')}<IconDown />
          </Button>
        </div>
      </div>}
    </div>
  )
}
