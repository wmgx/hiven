import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, ActionBar, SurfaceStatus, SurfaceError, ValueChip, SurfaceHeaderActions } from '@hiven/plugin-ui'
import { getPluginDiffHost, type DiffSource } from '@hiven/plugin-diff'
import { DiffSourceChip } from './DiffSourceChip'
import { DiffExplanation } from './DiffExplanation'
import { useDiffSourceText } from './useDiffSourceText'
import { createDiffSourceReader } from './sourceReadLifetime'
import { compareLists, MAX_LIST_LINES, type ListCategory, type ListComparison } from './compareLists'
import { clampDiffHunkIndex, moveDiffHunkIndex } from './diffNavigation'

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
  const [editingSide, setEditingSide] = useState<'left' | 'right' | null>(null)
  const [category, setCategory] = useState<ListCategory>('common')
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
  useEffect(() => { if (selectedMode === undefined && jsonAvailable) setDiffMode('json') }, [selectedMode, jsonAvailable])

  const diffMode = selectedMode ?? (jsonAvailable ? 'json' : 'text')
  const renderMode: DiffMode = diffMode === 'set' ? 'set' : diffMode === 'json' && jsonAvailable ? 'json' : 'text'

  const displayText = (text: string, side: 'left' | 'right') => renderMode === 'json' && editingSide !== side
    ? formatJsonPreserveKeyOrder(text) ?? text : text
  const leftSnapshot = displayText(debouncedOriginal, 'left')
  const rightSnapshot = displayText(debouncedModified, 'right')
  const jsonHighlights = useMemo(() => renderMode === 'json' ? computeJsonLineHighlights(leftSnapshot, rightSnapshot) : null,
    [renderMode, leftSnapshot, rightSnapshot, computeJsonLineHighlights])
  const jsonDecorations = (side: 'left' | 'right') => (['changed', 'removed', 'added'] as const).map(kind => ({
    ranges: (jsonHighlights?.pathHighlights ?? []).filter(path => path.kind === kind).flatMap(path => path[side] ? [path[side]!] : []),
    className: `td-json-${kind}`, rulerColor: '',
  }))

  const comparison = useMemo<ListComparison>(() => {
    try { return compareLists(debouncedOriginal, debouncedModified) }
    catch { return { ok: false, reason: 'failed' } }
  }, [debouncedOriginal, debouncedModified])
  const values = comparison.ok ? comparison.values[category] : []
  const selectedValues = new Set(values)
  const setDecorations = (text: string) => {
    const selected: number[] = [], dimmed: number[] = []
    text.split(/\r\n|\r|\n/).forEach((line, i) => (selectedValues.has(line.trim()) ? selected : dimmed).push(i + 1))
    return [
      { lines: selected, className: 'td-set-selected', rulerColor: 'var(--primary)' },
      { lines: dimmed, className: '', inlineClassName: 'td-set-dim', rulerColor: '' },
    ]
  }

  // Editors stay live (originalText/modifiedText); only highlights use the debounce snapshot.
  const { leftHighlights, rightHighlights, leftRanges, rightRanges, navigationHunks } = useMemo(() => {
    if (renderMode === 'set') return { leftHighlights: [], rightHighlights: [], leftRanges: undefined, rightRanges: undefined, navigationHunks: [] }
    const textResult = computeTextLineDiff(debouncedOriginal, debouncedModified)
    if (renderMode === 'json') {
      const hl = jsonHighlights
      if (hl) {
        return {
          leftHighlights: hl.leftHighlights,
          rightHighlights: hl.rightHighlights,
          leftRanges: undefined,
          rightRanges: undefined,
          navigationHunks: hl.pathHighlights.map(path => ({
            leftLine: path.left?.startLineNumber ?? path.right?.startLineNumber ?? 1,
            rightLine: path.right?.startLineNumber ?? path.left?.startLineNumber ?? 1,
          })),
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
  }, [renderMode, debouncedOriginal, debouncedModified, jsonHighlights, computeTextLineDiff])

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
      <SurfaceHeaderActions>
        <ValueChip label={t('diff.mode')} value={diffMode}
          options={(['text', 'json', 'set'] as const).map(value => ({ value, label: t(`diff.${value}Mode`) }))}
          onChange={value => setDiffMode(value as DiffMode)} onPreview={value => setDiffMode(value as DiffMode)} />
        {diffMode === 'set' && <ValueChip label={t('compare.result')} value={category}
          options={(['common', 'leftOnly', 'rightOnly', 'union'] as const).map(value => ({ value, label: t(`compare.${value}`) }))}
          onChange={value => setCategory(value as ListCategory)} onPreview={value => setCategory(value as ListCategory)} />}
      </SurfaceHeaderActions>
      <SurfaceError>{diffMode === 'json' && renderMode === 'text' ? t('diff.fallbackToText')
        : diffMode === 'set' && !comparison.ok ? t(`compare.error.${comparison.reason}`, { limit: MAX_LIST_LINES }) : null}</SurfaceError>

      <div className="td-pane-labels">
        {([
          ['original', originalSource, setOriginalSource, originalReader],
          ['modified', modifiedSource, setModifiedSource, modifiedReader],
        ] as const).map(([side, source, setSource, reader]) => (
          <div className="td-pane-label" key={side}>
            <span>{t(`surface.${side}`)}</span>
            <DiffSourceChip host={host} t={t} source={source} text={side === 'original' ? originalText : modifiedText}
              options={sourceOptions} reader={reader} setSource={setSource} />
          </div>
        ))}
      </div>

      {/* Editor body */}
      <div className="td-body" onFocusCapture={event => {
        const editor = (event.target as HTMLElement).closest('.monaco-editor')
        if (editor) setEditingSide(editor === event.currentTarget.querySelector('.monaco-editor') ? 'left' : 'right')
      }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setEditingSide(null) }}>
        <DualEditorView
          leftText={displayText(originalText, 'left')}
          rightText={displayText(modifiedText, 'right')}
          leftLineDecorations={diffMode === 'set' ? setDecorations(debouncedOriginal) : jsonHighlights ? [] : undefined}
          leftRangeDecorations={jsonHighlights ? jsonDecorations('left') : undefined}
          rightLineDecorations={diffMode === 'set' ? setDecorations(debouncedModified) : jsonHighlights ? [] : undefined}
          rightRangeDecorations={jsonHighlights ? jsonDecorations('right') : undefined}
          leftHighlights={leftHighlights}
          rightHighlights={rightHighlights}
          leftRanges={leftRanges}
          rightRanges={rightRanges}
          lineRevealRequest={lineRevealRequest}
          layout="side-by-side"
          language={editorLanguage}
          onLeftChange={text => { if (text !== displayText(originalText, 'left')) setOriginalText(text) }}
          onRightChange={text => { if (text !== displayText(modifiedText, 'right')) setModifiedText(text) }}
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

      <SurfaceStatus>{diffMode === 'set' ? <span>{t('compare.count', { category: t(`compare.${category}`), count: values.length })}{comparison.ok && (comparison.ignored.left + comparison.ignored.right + comparison.duplicates.left + comparison.duplicates.right > 0) && <small> · {t('compare.excluded', { blank: comparison.ignored.left + comparison.ignored.right, dup: comparison.duplicates.left + comparison.duplicates.right })}</small>}</span>
        : <span className="td-nav"><Button variant="ghost" disabled={!totalHunks} aria-label={t('diff.navPrev')} onClick={() => navigateHunk(-1)}><IconUp /></Button>
          {jsonHighlights ? t('diff.jsonCount', {
            count: jsonHighlights.changes.length,
            changed: jsonHighlights.changes.filter(change => change.kind === 'changed').length,
            removed: jsonHighlights.changes.filter(change => change.kind === 'removed').length,
            added: jsonHighlights.changes.filter(change => change.kind === 'added').length,
          }) : totalHunks ? t('diff.navPosition', { current: displayedHunkIndex + 1, total: totalHunks }) : t('diff.noChanges')}
          <Button variant="ghost" disabled={!totalHunks} aria-label={t('diff.navNext')} onClick={() => navigateHunk(1)}><IconDown /></Button></span>}</SurfaceStatus>
      <DiffExplanation host={host} t={t} original={originalText} modified={modifiedText}>{aiAction => <ActionBar>{host.OutputActions && <host.OutputActions
        text={diffMode === 'set' ? values.join('\n') : [...leftHighlights.map(line => `- ${leftSnapshot.split('\n')[line - 1]}`), ...rightHighlights.map(line => `+ ${rightSnapshot.split('\n')[line - 1]}`)].join('\n')}
        more={[
          ...(diffMode === 'json' ? [{ id: 'format', label: t('diff.format'), run: handleFormat, disabled: !canFormat }] : []),
          { id: 'swap', label: t('diff.swap'), run: handleSwap },
          { id: 'detach', label: t('diff.detach'), run: handleDetach },
          ...(aiAction ? [aiAction] : []),
        ]} />}</ActionBar>}</DiffExplanation>
    </div>
  )
}
