/**
 * First-party Text Diff plugin.
 */

import { definePlugin, type PaneInput } from '@hiven/plugin'
import { TextDiffRenderer } from './TextDiffRenderer'

type PaneSnapshot = {
  activePaneId: string
  previousActivePaneId?: string
  paneIds: string[]
  renderers?: Record<string, {
    rendererId: string
    ownerPluginId?: string
    ownerContributionId?: string
  }>
}

function resolvePanePair(snapshot: PaneSnapshot): { originalPaneId: string; modifiedPaneId: string } | null {
  const { activePaneId, previousActivePaneId, paneIds } = snapshot
  if (paneIds.length < 2) return null
  if (previousActivePaneId && previousActivePaneId !== activePaneId && paneIds.includes(previousActivePaneId)) {
    return { originalPaneId: previousActivePaneId, modifiedPaneId: activePaneId }
  }
  const originalPaneId = paneIds.includes(activePaneId) ? activePaneId : paneIds[0]
  const modifiedPaneId = paneIds.find((paneId) => paneId !== originalPaneId)
  return modifiedPaneId ? { originalPaneId, modifiedPaneId } : null
}

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
          const pair = resolvePanePair(snapshot)
          if (!pair) return { ok: false, message: 'Need 2 panes for this command. Please open another pane first.' }
          const result = ctx.api.dispatchEffects([
            ...clearExistingTextDiffEffects(snapshot),
            ...textDiffEffects(pair.originalPaneId, pair.modifiedPaneId),
          ])
          if (result.errors.length > 0) return { ok: false, message: result.errors[0] }
          return { ok: true }
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
