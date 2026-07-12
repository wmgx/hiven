/**
 * DiffPageView - Fullscreen diff page that replaces EditorView.
 * Opened via workspace store's openDiffPage(), closed via ESC.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  getPluginHostSdk,
  detectExternalEditorLanguage,
  type FullscreenView,
} from '@hiven/plugin'
import {
  SegmentedControl,
  SurfaceToolbar,
  ToolbarButton,
} from '@hiven/plugin-ui'
import { CloseIcon } from '@hiven/plugin-ui/icons'
import { canUseSemanticJsonDiff, isAutoDiffExitKey } from './autoDiffMode'
import { useDiffSourceText } from './useDiffSourceText'
import './style.css'

const PLUGIN_ID = 'text-diff'

type DiffPageProps = {
  source: FullscreenView & { type: 'diff' }
}

export function DiffPageView({ source }: DiffPageProps) {
  const { kits, hooks } = getPluginHostSdk()
  const { DualEditorView, diff } = kits
  const t = hooks.useT(PLUGIN_ID)
  const settings = hooks.useSettings()
  const { clearActiveFullscreenView } = hooks.useWorkspaceActions()

  const [originalText, setOriginalText] = useDiffSourceText(source.original)
  const [modifiedText, setModifiedText] = useDiffSourceText(source.modified)

  const jsonAvailable = useMemo(
    () => canUseSemanticJsonDiff(originalText, modifiedText),
    [originalText, modifiedText],
  )
  const [jsonEnabled, setJsonEnabled] = useState(() => canUseSemanticJsonDiff(originalText, modifiedText))
  const selectedMode = jsonEnabled ? 'json' : 'text'
  const renderMode = jsonEnabled && jsonAvailable ? 'json' : 'text'

  const { leftText, rightText, leftHighlights, rightHighlights, leftRanges, rightRanges, jsonChangeCount } = useMemo(() => {
    // JSON mode: preserve user formatting; structural path → character-range blocks.
    if (renderMode === 'json') {
      const hl = diff.computeJsonLineHighlights(originalText, modifiedText)
      if (hl) {
        return {
          leftText: originalText,
          rightText: modifiedText,
          leftHighlights: hl.leftHighlights,
          rightHighlights: hl.rightHighlights,
          leftRanges: hl.leftRanges,
          rightRanges: hl.rightRanges,
          jsonChangeCount: hl.changes.length,
        }
      }
    }

    const { leftHighlights, rightHighlights } = diff.computeTextLineDiff(originalText, modifiedText)
    return {
      leftText: originalText,
      rightText: modifiedText,
      leftHighlights,
      rightHighlights,
      leftRanges: undefined as undefined,
      rightRanges: undefined as undefined,
      jsonChangeCount: 0,
    }
  }, [renderMode, originalText, modifiedText, diff])

  const diffCount = renderMode === 'json'
    ? jsonChangeCount
    : Math.max(leftHighlights.length, rightHighlights.length)

  // Language: JSON mode always uses Monaco `json` for folding/syntax; text mode
  // keeps auto language detection from pane/content.
  const editorLanguage = useMemo(
    () => jsonEnabled
      ? 'json'
      : detectExternalEditorLanguage(
        [originalText, modifiedText],
        [source.original.language, source.modified.language],
      ),
    [jsonEnabled, originalText, modifiedText, source.original.language, source.modified.language],
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
            { value: 'text', label: t('diff.textMode') },
            { value: 'json', label: t('diff.jsonMode') },
          ]}
          onChange={(value) => setJsonEnabled(value === 'json')}
        />

        {jsonEnabled && (
          <ToolbarButton
            type="button"
            className="text-diff-format-button"
            onClick={() => {
              const left = diff.formatJsonPreserveKeyOrder(originalText)
              const right = diff.formatJsonPreserveKeyOrder(modifiedText)
              if (left != null) setOriginalText(left)
              if (right != null) setModifiedText(right)
            }}
            disabled={!diff.parseJson(originalText).ok && !diff.parseJson(modifiedText).ok}
            title={t('diff.formatHint')}
            aria-label={t('diff.format')}
          >
            {t('diff.format')}
          </ToolbarButton>
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
          leftRanges={leftRanges}
          rightRanges={rightRanges}
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

      {jsonEnabled && renderMode === 'text' && (
        <div className="text-diff-fallback" role="status">
          <span className="text-diff-fallback-dot" aria-hidden />
          {t('diff.fallbackToText')}
        </div>
      )}
    </div>
  )
}
