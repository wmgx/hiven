/**
 * Text Diff plugin renderer.
 * Owns the plain text comparison UI and delegates only the line highlight
 * calculation to diff-kit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import type { PaneInput, RendererProps } from '@fluxtext/plugin'
import { t } from '../../i18n'
import { computeTextLineDiff } from '../../kits/diff/lineDiff'
import { DualEditorView } from '../../kits/ui/DualEditorView'
import { detectExternalEditorLanguage } from '@fluxtext/plugin'
import {
  buildDiffTree,
  buildJsonDiffViewModel,
  buildSideLines,
  parseJson,
} from '../../kits/diff/jsonSemanticDiff'
import type { JsonArrayCompareMode } from '../../kits/diff/jsonSemanticDiff'
import {
  canUseSemanticJsonDiff,
  decideAutoDiffMode,
  isAutoDiffExitKey,
  normalizeAutoDiffLayout,
} from './autoDiffMode'

type TextDiffInputs = {
  original: PaneInput
  modified: PaneInput
  renderMode?: 'side-by-side' | 'inline'
}

export function TextDiffRenderer({ inputs, host }: RendererProps<TextDiffInputs>) {
  const originalPane = inputs?.original
  const modifiedPane = inputs?.modified
  const originalPaneId = originalPane?.paneId
  const modifiedPaneId = modifiedPane?.paneId
  const originalText = originalPane?.text ?? ''
  const modifiedText = modifiedPane?.text ?? ''
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)

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
      ? buildJsonDiffViewModel(originalText, modifiedText, { arrayCompareMode })
      : null,
    [semanticAvailable, originalText, modifiedText, arrayCompareMode],
  )
  const changes = viewModel?.changes ?? []
  const { leftText, rightText, leftHighlights, rightHighlights } = useMemo(() => {
    if (autoMode === 'json-semantic') {
      const origParsed = parseJson(originalText)
      const modParsed = parseJson(modifiedText)
      if (origParsed.ok && modParsed.ok && origParsed.value != null && modParsed.value != null) {
        const tree = buildDiffTree(origParsed.value, modParsed.value, { arrayCompareMode })
        const leftLines = buildSideLines(tree, 'left')
        const rightLines = buildSideLines(tree, 'right')
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

    const { leftHighlights, rightHighlights } = computeTextLineDiff(originalText, modifiedText)
    return { leftText: originalText, rightText: modifiedText, leftHighlights, rightHighlights }
  }, [autoMode, originalText, modifiedText, arrayCompareMode])
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
          {t(locale, 'textDiff.title')}: {originalPane.title} ↔ {modifiedPane.title}
        </span>
        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}>
          {autoMode === 'json-semantic' ? t(locale, 'diff.jsonSemanticDiff') : t(locale, 'diff.textLineDiff')}
        </span>
        {autoMode === 'json-semantic' && changes.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-warning-bg, #fff3cd)', color: 'var(--color-warning-text, #856404)' }}>
            {t(locale, 'diff.changeCount', { count: changes.length })}
          </span>
        )}
        {autoMode === 'json-semantic' && changes.length === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>
            {t(locale, 'diff.semanticEqual')}
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
          title={semanticAvailable ? t(locale, 'diff.semantic') : t(locale, 'diff.semanticUnavailable')}
          onClick={() => setSemanticEnabled((enabled) => !enabled)}
        >
          {t(locale, 'diff.semantic')}
        </button>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={host.close}
        >
          {t(locale, 'diff.exit')}
        </button>
      </div>

      {autoMode === 'json-semantic' && (
        <div
          className="h-[26px] flex items-center px-3 gap-2 shrink-0"
          style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
        >
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {t(locale, 'diff.array')}:
          </span>
          {(['by-index', 'unordered-scalar', 'by-object-key'] as const).map((mode) => (
            <button
              key={mode}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: arrayMode === mode ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: arrayMode === mode ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
              onClick={() => setArrayMode(mode)}
            >
              {t(locale, mode === 'by-index' ? 'diff.byIndex' : mode === 'unordered-scalar' ? 'diff.unorderedScalar' : 'diff.byKey')}
            </button>
          ))}
          {arrayMode === 'by-object-key' && (
            <input
              className="text-[10px] px-1.5 py-0.5 rounded w-[60px]"
              style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-tertiary)' }}
              value={objectKey}
              onChange={(event) => setObjectKey(event.target.value)}
              placeholder={t(locale, 'diff.keyPlaceholder')}
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
