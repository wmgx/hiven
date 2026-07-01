/**
 * First-party Text Diff plugin.
 * Opens a fullscreen diff page to compare two text sources.
 */

import { definePlugin, type LauncherExecutionContext, type DiffSource } from '@hiven/plugin'
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
  ]
}

export const textDiffPlugin = definePlugin({
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
        surfaces: ['command-palette'],
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

                  // Materialize clipboard text
                  for (const source of selected) {
                    if (source.kind === 'clipboard') {
                      source.text = await ctx.api.getClipboardText()
                    }
                  }

                  ctx.api.openDiffPage({ original: selected[0], modified: selected[1] })
                  return { ok: true as const }
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
