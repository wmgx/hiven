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
} from '@hiven/plugin'
import {
  SegmentedControl,
  Select,
  SurfaceToolbar,
  TextInput,
  ToolbarButton,
} from '@hiven/plugin-ui'
import { CloseIcon } from '@hiven/plugin-ui/icons'
import {
  canUseSemanticJsonDiff,
  decideAutoDiffMode,
  isAutoDiffExitKey,
  normalizeAutoDiffLayout,
} from './autoDiffMode'
import './style.css'

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
    <div className="text-diff-surface">
      <SurfaceToolbar className="text-diff-toolbar">
        <div className="text-diff-title-group">
          <span className="text-diff-title">{t('textDiff.title')}</span>
          <span className="text-diff-source" title={`${originalPane.title} ↔ ${modifiedPane.title}`}>
            {originalPane.title} ↔ {modifiedPane.title}
          </span>
        </div>

        <SegmentedControl
          className="text-diff-mode-switch"
          value={autoMode === 'json-semantic' ? 'json-semantic' : 'text-line'}
          disabled={!semanticAvailable}
          aria-label={t('diff.mode')}
          options={[
            { value: 'text-line', label: t('diff.textMode') },
            { value: 'json-semantic', label: t('diff.semantic') },
          ]}
          onChange={(value) => setSemanticEnabled(value === 'json-semantic')}
        />

        {autoMode === 'json-semantic' && changes.length > 0 && (
          <span className="text-diff-status-badge" data-tone="changed">
            {t('diff.changeCount', { count: changes.length })}
          </span>
        )}
        {autoMode === 'json-semantic' && changes.length === 0 && (
          <span className="text-diff-status-badge" data-tone="equal">
            {t('diff.semanticEqual')}
          </span>
        )}

        {!semanticAvailable && (
          <span className="text-diff-hint" title={t('diff.semanticUnavailable')}>
            {t('diff.textLineDiff')}
          </span>
        )}

        <ToolbarButton
          type="button"
          className="text-diff-exit-button"
          onClick={host.close}
          title={t('diff.exit')}
        >
          <CloseIcon size={13} />
          {t('diff.exit')}
        </ToolbarButton>
      </SurfaceToolbar>

      {autoMode === 'json-semantic' && (
        <div className="text-diff-optionsbar">
          <span className="text-diff-options-label">
            {t('diff.array')}:
          </span>
          <Select
            className="text-diff-array-select"
            value={arrayMode}
            aria-label={t('diff.array')}
            options={[
              { value: 'by-index', label: t('diff.byIndex') },
              { value: 'unordered-scalar', label: t('diff.unorderedScalar') },
              { value: 'by-object-key', label: t('diff.byKey') },
            ]}
            onChange={(event) => setArrayMode(event.target.value as typeof arrayMode)}
          />
          {arrayMode === 'by-object-key' && (
            <TextInput
              className="text-diff-key-input"
              value={objectKey}
              onChange={(event) => setObjectKey(event.target.value)}
              placeholder={t('diff.keyPlaceholder')}
              aria-label={t('diff.keyPlaceholder')}
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
          monacoTheme={settings.theme === 'dark' ? 'flux-vscode-dark' : 'flux-vscode-light'}
          leftStickyScrollEnabled={originalPane.stickyScroll === true}
          rightStickyScrollEnabled={modifiedPane.stickyScroll === true}
        />
      </div>
    </div>
  )
}
