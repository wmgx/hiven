/**
 * First-party Text Diff plugin.
 */

import { definePlugin, type LauncherExecutionContext, type PaneInput } from '@hiven/plugin'
import { TextDiffRenderer } from './TextDiffRenderer'
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
  renderers?: Record<string, {
    rendererId: string
    ownerPluginId?: string
    ownerContributionId?: string
  }>
}

type TextDiffLauncherContext = LauncherExecutionContext

type TextSource = {
  sourceId: string
  kind: 'editor-pane' | 'clipboard' | 'empty' | 'snapshot'
  editorWindowId?: string
  paneId?: string
  title: string
  language?: string
  lineCount?: number
  modified?: boolean
  lastActiveAt?: number
  snapshotAt?: number
  contentProvider: 'live' | 'snapshot'
  text?: string
}

type DiffSource = TextSource

function textDiffEffects(originalPaneId: string, modifiedPaneId: string, sourceMeta?: { original?: TextSource; modified?: TextSource }) {
  return [{
    type: 'pane.setRenderer' as const,
    paneId: originalPaneId,
    renderer: 'text-diff.renderer',
    inputs: {
      original: { kind: 'pane' as const, paneId: originalPaneId },
      modified: { kind: 'pane' as const, paneId: modifiedPaneId },
      sourceMeta,
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

function runTextDiff(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot, originalPaneId: string, modifiedPaneId: string, sourceMeta?: { original?: TextSource; modified?: TextSource }) {
  const result = ctx.api.dispatchEffects([
    ...clearExistingTextDiffEffects(snapshot),
    ...textDiffEffects(originalPaneId, modifiedPaneId, sourceMeta),
  ])
  if (result.errors.length > 0) return { ok: false as const, message: result.errors[0] }
  return { ok: true as const }
}

function paneLabel(snapshot: PaneSnapshot, paneId: string): string {
  const index = snapshot.paneIds.indexOf(paneId)
  return snapshot.panes[paneId]?.title || 'Pane ' + (index >= 0 ? index + 1 : paneId)
}

function activePaneId(snapshot: PaneSnapshot): string | null {
  return snapshot.paneIds.includes(snapshot.activePaneId) ? snapshot.activePaneId : snapshot.paneIds[0] ?? null
}

function sourceId(source: DiffSource): string {
  return source.sourceId
}

function sourceLanguage(_snapshot: PaneSnapshot, source: DiffSource): string | undefined {
  return source.language
}

async function materializeSourcePane(
  ctx: TextDiffLauncherContext,
  source: DiffSource,
  language: string,
): Promise<string> {
  if (source.kind === 'editor-pane' && source.paneId) return source.paneId
  if (source.kind === 'snapshot') {
    return ctx.api.createPane({ text: source.text ?? '', title: source.title, language, focus: true, direction: 'right' })
  }
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
  return runTextDiff(ctx, ctx.api.getPaneSnapshot(), originalPaneId, modifiedPaneId, { original, modified })
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
  const paneSources = snapshot.paneIds.map((paneId) => paneTextSource(snapshot, paneId, 'editor-pane' as const))
  if (snapshot.paneIds.length === 1) return [...paneSources, clipboardTextSource(ctxFallbackTitle('Clipboard')), emptyTextSource()]
  const active = activePaneId(snapshot)
  const crossEditorSnapshots = snapshot.paneIds
    .filter((paneId) => paneId !== active)
    .map((paneId) => paneTextSource(snapshot, paneId, 'snapshot' as const))
  return [...paneSources, ...crossEditorSnapshots]
}

function paneTextSource(snapshot: PaneSnapshot, paneId: string, kind: 'editor-pane' | 'snapshot'): TextSource {
  const title = paneLabel(snapshot, paneId)
  return {
    sourceId: kind === 'snapshot' ? 'snapshot:' + paneId : 'pane:' + paneId,
    kind,
    paneId,
    title: kind === 'snapshot' ? title + ' · snapshot' : title,
    language: snapshot.panes[paneId]?.language,
    snapshotAt: kind === 'snapshot' ? Date.now() : undefined,
    contentProvider: kind === 'snapshot' ? 'snapshot' : 'live',
  }
}

function clipboardTextSource(title: string): TextSource {
  return { sourceId: 'clipboard', kind: 'clipboard', title, contentProvider: 'snapshot', snapshotAt: Date.now() }
}

function emptyTextSource(): TextSource {
  return { sourceId: 'empty', kind: 'empty', title: 'Empty', contentProvider: 'snapshot' }
}

function ctxFallbackTitle(title: string): string {
  return title
}

function sourceLabel(ctx: TextDiffLauncherContext, _snapshot: PaneSnapshot, source: DiffSource): string {
  if (source.kind === 'clipboard') return ctx.t('choice.clipboard')
  if (source.kind === 'empty') return ctx.t('choice.createEmptyPane')
  if (source.kind === 'snapshot') return source.title
  return source.title
}

export const textDiffPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Text Diff',
        titleI18n: { zh: 'Text Diff' },
        icon: 'GitCompare',
        aliases: ['diff', 'compare', 'text diff', 'text-diff', '对比', '文本对比'],
        component: TextDiffSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: {
          defaultWidth: 980,
          defaultHeight: 680,
          minWidth: 720,
          minHeight: 500,
          closeOnBlur: false,
          resizable: true,
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
