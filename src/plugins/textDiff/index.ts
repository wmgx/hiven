/**
 * First-party Text Diff plugin.
 */

import { definePlugin, type LauncherExecutionContext, type PaneInput } from '@hiven/plugin'
import { TextDiffRenderer } from './TextDiffRenderer'

type PaneSnapshot = {
  activePaneId: string
  previousActivePaneId?: string
  paneIds: string[]
  panes: Record<string, {
    title?: string
    language?: string
    stickyScroll?: boolean
  }>
  renderers?: Record<string, {
    rendererId: string
    ownerPluginId?: string
    ownerContributionId?: string
  }>
}

type TextDiffLauncherContext = LauncherExecutionContext

type DiffSource =
  | { kind: 'pane'; paneId: string }
  | { kind: 'clipboard' }
  | { kind: 'empty' }

function textDiffEffects(originalPaneId: string, modifiedPaneId: string) {
  return [{
    type: 'pane.setRenderer' as const,
    paneId: originalPaneId,
    renderer: 'text-diff.renderer',
    inputs: {
      original: { kind: 'pane' as const, paneId: originalPaneId },
      modified: { kind: 'pane' as const, paneId: modifiedPaneId },
    },
    ownerPluginId: 'text-diff',
    ownerContributionId: 'text-diff.compare',
  }]
}

function clearExistingTextDiffEffects(snapshot: PaneSnapshot) {
  return Object.entries(snapshot.renderers ?? {})
    .filter(([, renderer]) => renderer.ownerPluginId === 'text-diff' || renderer.rendererId === 'text-diff.renderer')
    .map(([paneId]) => ({ type: 'pane.clearRenderer' as const, paneId }))
}

function runTextDiff(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot, originalPaneId: string, modifiedPaneId: string) {
  const result = ctx.api.dispatchEffects([
    ...clearExistingTextDiffEffects(snapshot),
    ...textDiffEffects(originalPaneId, modifiedPaneId),
  ])
  if (result.errors.length > 0) return { ok: false as const, message: result.errors[0] }
  return { ok: true as const }
}

function paneLabel(snapshot: PaneSnapshot, paneId: string): string {
  const index = snapshot.paneIds.indexOf(paneId)
  return snapshot.panes[paneId]?.title || `Pane ${index >= 0 ? index + 1 : paneId}`
}

function activePaneId(snapshot: PaneSnapshot): string | null {
  return snapshot.paneIds.includes(snapshot.activePaneId) ? snapshot.activePaneId : snapshot.paneIds[0] ?? null
}

function sourceId(source: DiffSource): string {
  return source.kind === 'pane' ? `pane:${source.paneId}` : source.kind
}

function sourceLanguage(snapshot: PaneSnapshot, source: DiffSource): string | undefined {
  return source.kind === 'pane' ? snapshot.panes[source.paneId]?.language : undefined
}

async function materializeSourcePane(
  ctx: TextDiffLauncherContext,
  source: DiffSource,
  language: string,
): Promise<string> {
  if (source.kind === 'pane') return source.paneId
  if (source.kind === 'clipboard') {
    const text = await ctx.api.getClipboardText()
    return ctx.api.createPane({ text, language, focus: true, direction: 'right' })
  }
  return ctx.api.createPane({ text: '', language, focus: true, direction: 'right' })
}

async function runTextDiffForSources(ctx: TextDiffLauncherContext, original: DiffSource, modified: DiffSource) {
  let snapshot = ctx.api.getPaneSnapshot()
  const originalLanguage = sourceLanguage(snapshot, original) || 'plaintext'
  const originalPaneId = await materializeSourcePane(ctx, original, originalLanguage)
  snapshot = ctx.api.getPaneSnapshot()
  const modifiedLanguage = sourceLanguage(snapshot, modified) || snapshot.panes[originalPaneId]?.language || originalLanguage
  const modifiedPaneId = await materializeSourcePane(ctx, modified, modifiedLanguage)
  return runTextDiff(ctx, ctx.api.getPaneSnapshot(), originalPaneId, modifiedPaneId)
}

function buildSourceChoiceOutput(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot) {
  if (snapshot.paneIds.length === 2) {
    return runTextDiff(ctx, snapshot, snapshot.paneIds[0], snapshot.paneIds[1])
  }
  const sources = selectableSources(snapshot)
  if (sources.length < 2) return { ok: false as const, message: ctx.t('choice.needTwoSources') }
  const sourceById = new Map(sources.map((source) => [sourceId(source), source]))
  return {
    ok: true as const,
    output: {
      choices: sources.map((source) => ({
        id: sourceId(source),
        title: sourceLabel(ctx, snapshot, source),
        primaryAction: () => ({ ok: false as const, message: ctx.t('choice.needTwoSources') }),
      })),
      selection: {
        type: 'multi' as const,
        min: 2,
        max: 2,
        submitTitle: ctx.t('choice.compareSelected'),
        submit: (choices) => {
          const selected = choices
            .map((choice) => sourceById.get(choice.id))
            .filter((source): source is DiffSource => Boolean(source))
          if (selected.length !== 2) return { ok: false as const, message: ctx.t('choice.needTwoSources') }
          return runTextDiffForSources(ctx, selected[0], selected[1])
        },
      },
    },
  }
}

function selectableSources(snapshot: PaneSnapshot): DiffSource[] {
  const paneSources = snapshot.paneIds.map((paneId) => ({ kind: 'pane' as const, paneId }))
  if (snapshot.paneIds.length === 1) return [...paneSources, { kind: 'clipboard' }, { kind: 'empty' }]
  return paneSources
}

function sourceLabel(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot, source: DiffSource): string {
  if (source.kind === 'pane') return paneLabel(snapshot, source.paneId)
  if (source.kind === 'clipboard') return ctx.t('choice.clipboard')
  return ctx.t('choice.createEmptyPane')
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
          return buildSourceChoiceOutput(ctx, snapshot)
        },
      },
    ],
  },
  commands: [
    {
      id: 'text-diff.compare',
      title: 'command.compare.title',
      description: 'command.compare.description',
      icon: 'git-compare',
      live: { pinnable: false },
      inputs: [
        { key: 'original', label: 'input.original.label', kind: 'pane', required: true },
        { key: 'modified', label: 'input.modified.label', kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'auto-fill', fallback: 'prompt' },
      run(ctx) {
        const originalPaneId = (ctx.inputs.original as PaneInput).paneId
        const modifiedPaneId = (ctx.inputs.modified as PaneInput).paneId
        return {
          effects: textDiffEffects(originalPaneId, modifiedPaneId),
        }
      },
    },
  ],

  renderers: [
    {
      id: 'text-diff.renderer',
      title: 'renderer.title',
      surface: 'workspace',
      inputKinds: ['pane', 'pane'],
      component: TextDiffRenderer,
    },
  ],
})

export default textDiffPlugin
