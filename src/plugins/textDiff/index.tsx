/**
 * First-party Text Diff plugin.
 * Provides a surface for side-by-side text comparison with line-level and
 * character-level diff highlighting.
 */

import { lazy, Suspense } from 'react'
import { definePlugin, type LauncherExecutionContext, type DiffSourcePayload as DiffSource, type PluginSurfaceProps } from '@hiven/plugin'
import './style.css'

const TextDiffSurface = lazy(async () => {
  const module = await import('./TextDiffSurface')
  return { default: module.TextDiffSurface }
})

function LazyTextDiffSurface(props: PluginSurfaceProps) {
  return (
    <Suspense fallback={null}>
      <TextDiffSurface {...props} />
    </Suspense>
  )
}

type PaneSnapshot = {
  activePaneId: string
  previousActivePaneId?: string
  paneIds: string[]
  panes: Record<string, {
    title?: string
    language?: string
    stickyScroll?: boolean
    text?: string
    origin?: 'editor' | 'quick-editor'
  }>
}

type TextDiffLauncherContext = LauncherExecutionContext

function paneLabel(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot, paneId: string): string {
  const index = snapshot.paneIds.indexOf(paneId)
  const pane = snapshot.panes[paneId]
  const base = pane?.title || ctx.t('source.paneTitle', { index: index >= 0 ? index + 1 : paneId })
  if (pane?.origin === 'quick-editor') {
    return ctx.t('choice.quickEditorPane', { title: base })
  }
  if (pane?.origin === 'editor') {
    return ctx.t('choice.editorPane', { title: base })
  }
  return base
}

/** Snapshot ids may be prefixed `quick:` on collision; store the real pane id for write-back. */
function resolvePaneBinding(
  snapshotPaneId: string,
  origin?: 'editor' | 'quick-editor',
): { paneId: string; origin?: 'editor' | 'quick-editor' } {
  if (origin === 'quick-editor' && snapshotPaneId.startsWith('quick:')) {
    return { paneId: snapshotPaneId.slice('quick:'.length), origin }
  }
  return { paneId: snapshotPaneId, origin }
}

function buildSourceList(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot): DiffSource[] {
  // Only the active editor pane has a text snapshot; quick-editor panes all do.
  const paneSources: DiffSource[] = snapshot.paneIds.filter((id) =>
    snapshot.panes[id]?.origin !== 'editor' || id === snapshot.activePaneId,
  ).map((snapshotPaneId) => {
    const pane = snapshot.panes[snapshotPaneId]
    const binding = resolvePaneBinding(snapshotPaneId, pane?.origin)
    return {
      sourceId: 'pane:' + snapshotPaneId,
      kind: 'editor-pane' as const,
      paneId: binding.paneId,
      origin: binding.origin,
      title: paneLabel(ctx, snapshot, snapshotPaneId),
      language: pane?.language,
      // Keep the source snapshot available after leaving the launcher.
      text: pane?.text ?? '',
    }
  })
  return [
    ...paneSources,
    { sourceId: 'clipboard', kind: 'clipboard' as const, title: ctx.t('choice.clipboard') },
    { sourceId: 'empty', kind: 'empty' as const, title: ctx.t('source.empty') },
  ]
}

export const textDiffPlugin = definePlugin({
  ui: {
    surfaces: ['main', 'json'].map((id) => ({
        id,
        kind: 'custom-view',
        title: 'Text Compare',
        titleI18n: { zh: '文本对比' },
        icon: 'GitCompare',
        aliases: ['diff', 'compare', 'text diff', '文本对比', 'duibi'],
        component: LazyTextDiffSurface,
        entry: { launcher: false, shortcutBindable: false },
        shell: {
          defaultWidth: 960,
          defaultHeight: 640,
          minWidth: 720,
          minHeight: 480,
          closeOnBlur: false,
          resizable: true,
          rendersTitlebar: true,
        },
      })),
  },
  launcher: {
    items: ['main', 'json'].map((mode) => ({
      id: mode === 'main' ? 'text-diff.compare' : 'text-diff.json',
      display: {
        title: mode === 'main' ? 'command.compare.title' : 'command.json.title',
        subtitle: 'command.compare.description',
        icon: 'GitCompare',
        aliases: mode === 'main'
          ? ['diff', 'compare', 'text diff', 'text-diff', '文本对比', 'duibi', 'wenbenduibi']
          : ['json diff', 'json compare', 'compare json', 'json对比', 'json差异'],
      },
      behavior: { type: 'perform' as const },
      surfaces: ['command-palette', 'global-launcher', 'editor-command-bar', 'quick-editor-command'],
      execute(ctx) {
        const sources = buildSourceList(ctx, ctx.api.getPaneSnapshot() as PaneSnapshot)
        ctx.api.openSurface(mode, { initialText: JSON.stringify({
          original: { sourceId: 'original', kind: 'empty', text: ctx.input?.text ?? '' },
          modified: { sourceId: 'modified', kind: 'empty', text: '' },
          sources,
        }) })
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
})

export default textDiffPlugin
