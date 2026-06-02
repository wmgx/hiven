/**
 * Text Diff plugin renderer.
 * Owns the plain text comparison UI and delegates only the line highlight
 * calculation to diff-kit.
 */

import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import type { PaneInput, RendererProps } from '../../workspace/pluginTypes'
import { t } from '../../i18n'
import { computeTextLineDiff } from '../../kits/diff/lineDiff'
import { DualEditorView } from '../../kits/ui/DualEditorView'

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

  const requestedLayout = inputs?.renderMode === 'inline' ? 'inline' : 'side-by-side'
  const [layoutOverride, setLayoutOverride] = useState<'side-by-side' | 'inline' | null>(null)
  const layout = layoutOverride ?? requestedLayout

  const { leftHighlights, rightHighlights } = useMemo(
    () => computeTextLineDiff(originalText, modifiedText),
    [originalText, modifiedText],
  )

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
          {t(locale, 'diff.textLineDiff')}
        </span>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: layout === 'side-by-side' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: layout === 'side-by-side' ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
          onClick={() => setLayoutOverride('side-by-side')}
        >
          {t(locale, 'diff.sideBySide')}
        </button>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: layout === 'inline' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: layout === 'inline' ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
          onClick={() => setLayoutOverride('inline')}
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

      <div className="flex-1 overflow-hidden">
        <DualEditorView
          leftText={originalText}
          rightText={modifiedText}
          leftHighlights={leftHighlights}
          rightHighlights={rightHighlights}
          layout={layout}
          language={originalPane.language || 'plaintext'}
          onLeftFocus={handleOriginalFocus}
          onRightFocus={handleModifiedFocus}
          onLeftChange={handleOriginalChange}
          onRightChange={handleModifiedChange}
          fontSize={settings.fontSize}
          lineNumbers={settings.lineNumbers}
          wordWrap={settings.wordWrap}
        />
      </div>
    </div>
  )
}
