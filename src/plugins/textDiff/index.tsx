/**
 * First-party Text Diff plugin.
 * Provides a surface for side-by-side text comparison with line-level and
 * character-level diff highlighting.
 */

import { definePlugin, type LauncherExecutionContext, type DiffSource } from '@hiven/plugin'
import { TextDiffSurface } from './TextDiffSurface'
import './style.css'

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
  const base = pane?.title || 'Pane ' + (index >= 0 ? index + 1 : paneId)
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
  const paneSources: DiffSource[] = snapshot.paneIds.map((snapshotPaneId) => {
    const pane = snapshot.panes[snapshotPaneId]
    const binding = resolvePaneBinding(snapshotPaneId, pane?.origin)
    return {
      sourceId: 'pane:' + snapshotPaneId,
      kind: 'editor-pane' as const,
      paneId: binding.paneId,
      origin: binding.origin,
      title: paneLabel(ctx, snapshot, snapshotPaneId),
      language: pane?.language,
      // Capture text at choice-build time so openDiffPage receives content
      // even when the host snapshot is later gone (cross-window).
      text: pane?.text ?? '',
    }
  })
  return [
    ...paneSources,
    { sourceId: 'clipboard', kind: 'clipboard' as const, title: ctx.t('choice.clipboard') },
    { sourceId: 'empty', kind: 'empty' as const, title: ctx.t('choice.createEmptyPane') },
  ]
}

function materializeSourceText(source: DiffSource): string {
  if (source.kind === 'clipboard') return source.text ?? ''
  if (source.kind === 'empty') return ''
  if (source.kind === 'editor-pane') return source.text ?? ''
  return source.text ?? ''
}

export const textDiffPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Text Compare',
        titleI18n: { zh: '文本对比' },
        icon: 'GitCompare',
        aliases: ['diff', 'compare', 'text diff', '文本对比', 'duibi'],
        component: TextDiffSurface,
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
      },
    ],
  },
  launcher: {
    items: [
      {
        id: 'text-diff.compare',
        display: {
          title: 'command.compare.title',
          subtitle: 'command.compare.description',
          icon: 'GitCompare',
          aliases: ['diff', 'compare', 'text diff', 'text-diff', 'duibi', 'wenben duibi'],
        },
        surfaces: ['command-palette', 'global-launcher', 'quick-editor-command'],
        execute(ctx) {
          const snapshot = ctx.api.getPaneSnapshot() as PaneSnapshot
          const sources = buildSourceList(ctx, snapshot)

          if (sources.length < 2) {
            return { ok: false as const, message: ctx.t('choice.needTwoSources') }
          }

          const sourceById = new Map(sources.map((s) => [s.sourceId, s]))

          return {
            ok: true as const,
            output: {
              choices: sources.map((s) => ({
                id: s.sourceId,
                title: s.title,
                primaryAction: () => undefined,
              })),
              selection: {
                type: 'multi' as const,
                min: 2,
                max: 2,
                submitTitle: ctx.t('choice.compareSelected'),
                async submit(choices) {
                  const selected = choices
                    .map((c) => sourceById.get(c.id))
                    .filter((s): s is DiffSource => Boolean(s))
                  if (selected.length !== 2) {
                    return { ok: false as const, message: ctx.t('choice.needTwoSources') }
                  }

                  for (const source of selected) {
                    if (source.kind === 'clipboard') {
                      source.text = await ctx.api.getClipboardText()
                    }
                  }

                  const payload = {
                    original: { ...selected[0], text: materializeSourceText(selected[0]) },
                    modified: { ...selected[1], text: materializeSourceText(selected[1]) },
                  }

                  ctx.api.openDiffPage(payload as any)
                  return { ok: true as const, keepOpen: true }
                },
              },
            },
          }
        },
      },
    ],
  },
})

export default textDiffPlugin
