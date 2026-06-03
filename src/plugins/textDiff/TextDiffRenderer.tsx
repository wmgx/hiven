/**
 * Text Diff plugin renderer.
 * Owns the plain text comparison UI and delegates only the line highlight
 * calculation to host-injected diff kits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getPluginHostSdk,
  detectExternalEditorLanguage,
  type PaneInput,
  type RendererProps,
  type JsonArrayCompareMode,
} from '@fluxtext/plugin'
import {
  canUseSemanticJsonDiff,
  decideAutoDiffMode,
  isAutoDiffExitKey,
  normalizeAutoDiffLayout,
} from './autoDiffMode'

const PLUGIN_ID = 'text-diff'

type TextDiffInputs = {
  original: PaneInput
  modified: PaneInput
  renderMode?: 'side-by-side' | 'inline'
}

export function TextDiffRenderer({ inputs, host }: RendererProps<TextDiffInputs>) {
  const { kits, hooks } = getPluginHostSdk()
  const { DualEditorView, diff } = kits
  const t = hooks.useT(PLUGIN_ID)
  const settings = hooks.useSettings()

  const originalPane = inputs?.original
  const modifiedPane = inputs?.modified
  const originalPaneId = originalPane?.paneId
  const modifiedPaneId = modifiedPane?.paneId
  const originalText = originalPane?.text ?? ''
  const modifiedText = modifiedPane?.text ?? ''

  const layout = normalizeAutoDiffLayout(inputs?.renderMode)
  const [semanticEnabled, setSemanticEnabled] = useState(true)
  const [arrayMode, setArrayMode] = useState<'by-index' | 'unordered-scalar' | 'by-object-key'>('by-index')
  const [objectKey, setObjectKey] = useState('id')
  const semanticAvailable = useMemo(
    () => canUseSemanticJsonDiff(originalText, modifiedText),
    [originalText, modifiedText],
  )
  const autoMode = useMemo(
    () => decideAutoDiffMode({ leftText: originalText, rightText: modifiedText, semanticEnabled }),
    [originalText, modifiedText, semanticEnabled],
  )
  const arrayCompareMode = useMemo<JsonArrayCompareMode>(() => (
    arrayMode === 'by-object-key'
      ? { type: 'by-object-key', key: objectKey }
      : { type: arrayMode }
  ), [arrayMode, objectKey])

  const viewModel = useMemo(
    () => semanticAvailable
      ? diff.buildJsonDiffViewModel(originalText, modifiedText, { arrayCompareMode })
      : null,
    [semanticAvailable, originalText, modifiedText, arrayCompareMode, diff],
  )
  const changes = viewModel?.changes ?? []
  const { leftText, rightText, leftHighlights, rightHighlights } = useMemo(() => {
    if (autoMode === 'json-semantic') {
      const origParsed = diff.parseJson(originalText)
      const modParsed = diff.parseJson(modifiedText)
      if (origParsed.ok && modParsed.ok && origParsed.value != null && modParsed.value != null) {
        const tree = diff.buildDiffTree(origParsed.value, modParsed.value, { arrayCompareMode })
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

    const { leftHighlights, rightHighlights } = diff.computeTextLineDiff(originalText, modifiedText)
    return { leftText: originalText, rightText: modifiedText, leftHighlights, rightHighlights }
  }, [autoMode, originalText, modifiedText, arrayCompareMode, diff])
  const editorLanguage = useMemo(
    () => autoMode === 'json-semantic'
      ? 'json'
      : detectExternalEditorLanguage(
        [originalText, modifiedText],
        [originalPane?.language, modifiedPane?.language],
      ),
    [autoMode, originalText, modifiedText, originalPane?.language, modifiedPane?.language],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAutoDiffExitKey(event.key)) return
      event.preventDefault()
      host.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [host])

  const handleOriginalFocus = useCallback(() => {
    if (originalPaneId) host.focusPane(originalPaneId)
  }, [originalPaneId, host])

  const handleModifiedFocus = useCallback(() => {
    if (modifiedPaneId) host.focusPane(modifiedPaneId)
  }, [modifiedPaneId, host])

  const handleOriginalChange = useCallback((text: string) => {
    if (originalPaneId) host.updatePaneText(originalPaneId, text)
  }, [originalPaneId, host])

  const handleModifiedChange = useCallback((text: string) => {
    if (modifiedPaneId) host.updatePaneText(modifiedPaneId, text)
  }, [modifiedPaneId, host])

  if (!originalPane || !modifiedPane) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="h-[28px] flex items-center px-3 gap-2 shrink-0"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('textDiff.title')}: {originalPane.title} ↔ {modifiedPane.title}
        </span>
        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}>
          {autoMode === 'json-semantic' ? t('diff.jsonSemanticDiff') : t('diff.textLineDiff')}
        </span>
        {autoMode === 'json-semantic' && changes.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-warning-bg, #fff3cd)', color: 'var(--color-warning-text, #856404)' }}>
            {t('diff.changeCount', { count: changes.length })}
          </span>
        )}
        {autoMode === 'json-semantic' && changes.length === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>
            {t('diff.semanticEqual')}
          </span>
        )}
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 disabled:opacity-50"
          style={{
            background: semanticEnabled && semanticAvailable ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
            color: semanticEnabled && semanticAvailable ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
          disabled={!semanticAvailable}
          aria-pressed={semanticEnabled && semanticAvailable}
          title={semanticAvailable ? t('diff.semantic') : t('diff.semanticUnavailable')}
          onClick={() => setSemanticEnabled((enabled) => !enabled)}
        >
          {t('diff.semantic')}
        </button>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={host.close}
        >
          {t('diff.exit')}
        </button>
      </div>

      {autoMode === 'json-semantic' && (
        <div
          className="h-[26px] flex items-center px-3 gap-2 shrink-0"
          style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
        >
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('diff.array')}:
          </span>
          {(['by-index', 'unordered-scalar', 'by-object-key'] as const).map((mode) => (
            <button
              key={mode}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: arrayMode === mode ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: arrayMode === mode ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
              onClick={() => setArrayMode(mode)}
            >
              {t(mode === 'by-index' ? 'diff.byIndex' : mode === 'unordered-scalar' ? 'diff.unorderedScalar' : 'diff.byKey')}
            </button>
          ))}
          {arrayMode === 'by-object-key' && (
            <input
              className="text-[10px] px-1.5 py-0.5 rounded w-[60px]"
              style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-tertiary)' }}
              value={objectKey}
              onChange={(event) => setObjectKey(event.target.value)}
              placeholder={t('diff.keyPlaceholder')}
            />
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <DualEditorView
          leftText={leftText}
          rightText={rightText}
          leftHighlights={leftHighlights}
          rightHighlights={rightHighlights}
          layout={layout}
          language={editorLanguage}
          onLeftFocus={handleOriginalFocus}
          onRightFocus={handleModifiedFocus}
          onLeftChange={handleOriginalChange}
          onRightChange={handleModifiedChange}
          fontSize={settings.fontSize}
          lineNumbers={settings.lineNumbers}
          wordWrap={settings.wordWrap}
          leftStickyScrollEnabled={originalPane.stickyScroll === true}
          rightStickyScrollEnabled={modifiedPane.stickyScroll === true}
        />
      </div>
    </div>
  )
}
