/**
 * DiffPageView - Fullscreen diff page that replaces EditorView.
 * Opened via workspace store's openDiffPage(), closed via ESC.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getPluginHostSdk,
  detectExternalEditorLanguage,
  type DiffSource,
  type FullscreenView,
} from '@hiven/plugin'
import {
  SegmentedControl,
  SurfaceToolbar,
  ToolbarButton,
} from '@hiven/plugin-ui'
import { CloseIcon } from '@hiven/plugin-ui/icons'
import { canUseSemanticJsonDiff, isAutoDiffExitKey } from './autoDiffMode'
import './style.css'

const PLUGIN_ID = 'text-diff'

type DiffPageProps = {
  source: FullscreenView & { type: 'diff' }
}

function useDiffSourceText(source: DiffSource): [string, (text: string) => void] {
  const { hooks } = getPluginHostSdk()
  const paneText = hooks.usePaneText(source.kind === 'editor-pane' ? source.paneId! : '')
  const [localText, setLocalText] = useState(source.text ?? '')
  const { setPaneText } = hooks.useWorkspaceActions()

  if (source.kind === 'editor-pane') {
    const text = paneText ?? ''
    const setText = useCallback((newText: string) => {
      if (source.paneId) setPaneText(source.paneId, newText)
    }, [source.paneId, setPaneText])
    return [text, setText]
  }

  return [localText, setLocalText]
}

export function DiffPageView({ source }: DiffPageProps) {
  const { kits, hooks } = getPluginHostSdk()
  const { DualEditorView, diff } = kits
  const t = hooks.useT(PLUGIN_ID)
  const settings = hooks.useSettings()
  const { clearActiveFullscreenView } = hooks.useWorkspaceActions()

  const [originalText, setOriginalText] = useDiffSourceText(source.original)
  const [modifiedText, setModifiedText] = useDiffSourceText(source.modified)

  // JSON semantic mode
  const semanticAvailable = useMemo(
    () => canUseSemanticJsonDiff(originalText, modifiedText),
    [originalText, modifiedText],
  )
  const [semanticEnabled, setSemanticEnabled] = useState(() => canUseSemanticJsonDiff(originalText, modifiedText))
  const selectedMode = semanticEnabled ? 'json-semantic' : 'text-line'
  const renderMode = semanticEnabled && semanticAvailable ? 'json-semantic' : 'text'

  // Compute diff
  const viewModel = useMemo(
    () => semanticAvailable ? diff.buildJsonDiffViewModel(originalText, modifiedText) : null,
    [semanticAvailable, originalText, modifiedText, diff],
  )
  const changes = viewModel?.changes ?? []

  const { leftText, rightText, leftHighlights, rightHighlights } = useMemo(() => {
    if (renderMode === 'json-semantic') {
      const origParsed = diff.parseJson(originalText)
      const modParsed = diff.parseJson(modifiedText)
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

    const { leftHighlights, rightHighlights } = diff.computeTextLineDiff(originalText, modifiedText)
    return { leftText: originalText, rightText: modifiedText, leftHighlights, rightHighlights }
  }, [renderMode, originalText, modifiedText, diff])

  const diffCount = renderMode === 'json-semantic'
    ? changes.length
    : Math.max(leftHighlights.length, rightHighlights.length)

  // Language detection
  const editorLanguage = useMemo(
    () => renderMode === 'json-semantic'
      ? 'json'
      : detectExternalEditorLanguage(
        [originalText, modifiedText],
        [source.original.language, source.modified.language],
      ),
    [renderMode, originalText, modifiedText, source.original.language, source.modified.language],
  )

  // ESC to close
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't close if user is in a Monaco find widget or similar input
      const target = event.target as HTMLElement | null
      if (target?.closest?.('input, textarea, [role="combobox"]')) return
      if (!isAutoDiffExitKey(event.key)) return
      event.preventDefault()
      clearActiveFullscreenView()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearActiveFullscreenView])

  return (
    <div className="text-diff-surface text-diff-fullscreen-page">
      <SurfaceToolbar className="text-diff-toolbar">
        <div className="text-diff-title-group">
          <span className="text-diff-title">{t('textDiff.title')}</span>
          <span className="text-diff-source" title={`${source.original.title} ↔ ${source.modified.title}`}>
            {source.original.title} ↔ {source.modified.title}
          </span>
          {diffCount > 0 && (
            <span className="text-diff-change-count">
              {t('diff.changeCount', { count: diffCount })}
            </span>
          )}
        </div>

        <SegmentedControl
          className="text-diff-mode-switch"
          value={selectedMode}
          aria-label={t('diff.mode')}
          options={[
            { value: 'text-line', label: t('diff.textMode') },
            { value: 'json-semantic', label: t('diff.semantic') },
          ]}
          onChange={(value) => setSemanticEnabled(value === 'json-semantic')}
        />

        {semanticEnabled && !semanticAvailable && (
          <span className="text-diff-hint" title={t('diff.semanticUnavailable')}>
            {t('diff.error')}
          </span>
        )}

        <ToolbarButton
          type="button"
          className="text-diff-exit-button"
          onClick={clearActiveFullscreenView}
          title={t('diff.exit')}
          aria-label={t('diff.exit')}
        >
          <CloseIcon size={13} />
        </ToolbarButton>
      </SurfaceToolbar>

      <div className="flex-1 overflow-hidden">
        <DualEditorView
          leftText={leftText}
          rightText={rightText}
          leftHighlights={leftHighlights}
          rightHighlights={rightHighlights}
          layout="side-by-side"
          language={editorLanguage}
          onLeftChange={setOriginalText}
          onRightChange={setModifiedText}
          fontSize={settings.fontSize}
          lineNumbers={settings.lineNumbers}
          wordWrap={settings.wordWrap}
          monacoTheme={settings.theme === 'dark' ? 'flux-vscode-dark' : 'flux-vscode-light'}
        />
      </div>
    </div>
  )
}
