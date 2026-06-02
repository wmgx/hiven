/**
 * FluxText Core - Core JSON Diff Renderer
 * Single DualEditorView instance. Diff algorithm switches based on JSON validity:
 *   Valid JSON   → semantic diff (buildDiffTree + buildSideLines), formatted output
 *   Invalid JSON → line-level LCS diff, raw text
 * Registered as 'core.json-diff' in the production plugin registry.
 */

import { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '../store'
import { buildJsonDiffViewModel, buildDiffTree, parseJson, buildSideLines } from '../workspace/jsonDiff'
import type { PaneInput, RendererProps } from '../workspace/pluginTypes'
import type { JsonArrayCompareMode } from '../workspace/jsonDiff'
import { t } from '../i18n'
import { DualEditorView } from './DualEditorView'
import { computeTextLineDiff } from '../workspace/lineDiff'

type JsonDiffInputs = {
  original: PaneInput
  modified: PaneInput
  renderMode?: 'side-by-side' | 'inline'
}

export function CoreJsonDiffRenderer({ inputs, surfaceId: _surfaceId, host }: RendererProps<JsonDiffInputs>) {
  const originalPane = inputs?.original
  const modifiedPane = inputs?.modified
  const originalPaneId = originalPane?.paneId
  const modifiedPaneId = modifiedPane?.paneId
  const originalText = originalPane?.text ?? ''
  const modifiedText = modifiedPane?.text ?? ''
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)

  const [layout, setLayout] = useState<'side-by-side' | 'inline'>(
    inputs?.renderMode === 'inline' ? 'inline' : 'side-by-side'
  )

  const [arrayMode, setArrayMode] = useState<'by-index' | 'unordered-scalar' | 'by-object-key'>('by-index')
  const [objectKey, setObjectKey] = useState('id')
  const arrayCompareMode = useMemo<JsonArrayCompareMode>(() => (
    arrayMode === 'by-object-key'
      ? { type: 'by-object-key', key: objectKey }
      : { type: arrayMode }
  ), [arrayMode, objectKey])

  const viewModel = useMemo(() =>
    buildJsonDiffViewModel(originalText, modifiedText, { arrayCompareMode }),
    [originalText, modifiedText, arrayCompareMode]
  )

  const isJsonValid = viewModel.status === 'json'
  const changes = viewModel.changes

  const invalidJsonMessage = [
    viewModel.originalError ? `${t(locale, 'diff.original')}: ${viewModel.originalError}` : '',
    viewModel.modifiedError ? `${t(locale, 'diff.modified')}: ${viewModel.modifiedError}` : '',
  ].filter(Boolean).join('\n')
  const invalidJsonSides = viewModel.invalidSides
    .map((side) => t(locale, side === 'original' ? 'diff.original' : 'diff.modified'))
    .join(' / ')

  // Compute editor content: semantic diff when JSON valid, line diff otherwise
  const { leftText, rightText, leftHighlights, rightHighlights } = useMemo(() => {
    if (isJsonValid) {
      const origParsed = parseJson(originalText)
      const modParsed = parseJson(modifiedText)
      if (origParsed.ok && modParsed.ok && origParsed.value != null && modParsed.value != null) {
        const tree = buildDiffTree(origParsed.value, modParsed.value, { arrayCompareMode })
        const leftLines  = buildSideLines(tree, 'left')
        const rightLines = buildSideLines(tree, 'right')
        return {
          leftText:        leftLines.map(l => l.text).join('\n'),
          rightText:       rightLines.map(l => l.text).join('\n'),
          leftHighlights:  leftLines.reduce<number[]>((acc, l, i) => { if (l.highlight) acc.push(i + 1); return acc }, []),
          rightHighlights: rightLines.reduce<number[]>((acc, l, i) => { if (l.highlight) acc.push(i + 1); return acc }, []),
        }
      }
    }
    const { leftHighlights, rightHighlights } = computeTextLineDiff(originalText, modifiedText)
    return { leftText: originalText, rightText: modifiedText, leftHighlights, rightHighlights }
  }, [isJsonValid, originalText, modifiedText, arrayCompareMode])

  useEffect(() => {
    setLayout(inputs?.renderMode === 'inline' ? 'inline' : 'side-by-side')
  }, [inputs?.renderMode])

  if (!originalPane || !modifiedPane) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div
        className="h-[28px] flex items-center px-3 gap-2 shrink-0"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t(locale, 'core.jsonDiff.title')}: {originalPane.title} ↔ {modifiedPane.title}
        </span>

        {!isJsonValid && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92400e' }} title={invalidJsonMessage}>
            {invalidJsonSides
              ? t(locale, 'diff.invalidJsonWithSides', { sides: invalidJsonSides })
              : t(locale, 'diff.invalidJson')}
          </span>
        )}

        {isJsonValid && changes.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-warning-bg, #fff3cd)', color: 'var(--color-warning-text, #856404)' }}>
            {t(locale, 'diff.changeCount', { count: changes.length })}
          </span>
        )}

        {isJsonValid && changes.length === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-text)' }}>
            ✓ {t(locale, 'diff.semanticEqual')}
          </span>
        )}

        {/* Layout buttons */}
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: layout === 'side-by-side' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: layout === 'side-by-side' ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
          onClick={() => setLayout('side-by-side')}
        >
          {t(locale, 'diff.sideBySide')}
        </button>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: layout === 'inline' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: layout === 'inline' ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
          onClick={() => setLayout('inline')}
        >
          {t(locale, 'diff.inline')}
        </button>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={host.close}
        >
          {t(locale, 'diff.exit')}
        </button>
      </div>

      {/* Array compare options (JSON valid only) */}
      {isJsonValid && (
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
              onChange={(e) => setObjectKey(e.target.value)}
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
          originalPaneId={originalPaneId}
          modifiedPaneId={modifiedPaneId}
          host={host}
          fontSize={settings.fontSize}
          lineNumbers={settings.lineNumbers}
          wordWrap={settings.wordWrap}
        />
      </div>
    </div>
  )
}
