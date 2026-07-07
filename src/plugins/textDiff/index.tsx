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
  }>
}

type TextDiffLauncherContext = LauncherExecutionContext

function paneLabel(snapshot: PaneSnapshot, paneId: string): string {
  const index = snapshot.paneIds.indexOf(paneId)
  return snapshot.panes[paneId]?.title || 'Pane ' + (index >= 0 ? index + 1 : paneId)
}

function buildSourceList(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot): DiffSource[] {
  const paneSources: DiffSource[] = snapshot.paneIds.map((paneId) => ({
    sourceId: 'pane:' + paneId,
    kind: 'editor-pane' as const,
    paneId,
    title: paneLabel(snapshot, paneId),
    language: snapshot.panes[paneId]?.language,
  }))
  return [
    ...paneSources,
    { sourceId: 'clipboard', kind: 'clipboard' as const, title: ctx.t('choice.clipboard') },
    { sourceId: 'empty', kind: 'empty' as const, title: ctx.t('choice.createEmptyPane') },
  ]
}

function materializeSourceText(source: DiffSource, snapshot: PaneSnapshot): string {
  if (source.kind === 'clipboard') return source.text ?? ''
  if (source.kind === 'empty') return ''
  if (source.kind === 'editor-pane' && source.paneId) {
    return source.text ?? ''
  }
  return ''
}

export const textDiffPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Text Compare',
        titleI18n: { zh: '文本对比' },
        icon: 'git-compare',
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
          rendersTitlebar: false,
          breadcrumbTitle: 'surface.breadcrumb',
          breadcrumbTitleI18n: { zh: '文本对比' },
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
          icon: 'git-compare',
          aliases: ['diff', 'compare', 'text diff', 'text-diff', 'duibi', 'wenben duibi'],
        },
        surfaces: ['command-palette', 'global-launcher'],
        pinnable: false,
        execute(ctx) {
          const snapshot = ctx.api.getPaneSnapshot()
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
                    original: { ...selected[0], text: materializeSourceText(selected[0], snapshot) },
                    modified: { ...selected[1], text: materializeSourceText(selected[1], snapshot) },
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
