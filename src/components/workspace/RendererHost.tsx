/**
 * FluxText - RendererHost
 * Mounts plugin renderer contributions into panes.
 *
 * Architecture (Push model):
 *   - RendererHost subscribes to pane text changes
 *   - Whenever pane content changes, it re-computes renderer inputs
 *   - Renderer component receives inputs via props (passive)
 *   - Renderer uses host.close() / host.dispatch() for side effects
 */

import { useMemo } from 'react'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { pluginRegistry } from '../../workspace/pluginRegistry'
import { applyEffects } from '../../workspace/effectRunner'
import type { FluxEffect, PaneRendererState, PaneId } from '../../workspace/types'
import type { RendererHostApi, PaneInput } from '../../workspace/pluginTypes'
import { useT, I18nNamespaceProvider } from '../../i18n'

interface RendererHostProps {
  paneId: PaneId
  rendererState: PaneRendererState
}

export function RendererHost({ paneId, rendererState }: RendererHostProps) {
  const panes = useWorkspaceStore((s) => s.panes)
  const clearPaneRenderer = useWorkspaceStore((s) => s.clearPaneRenderer)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const setPaneText = useWorkspaceStore((s) => s.setPaneText)
  const t = useT('workspace')

  // Resolve renderer from registry (prefer dev if it's a dev renderer)
  const rendererEntry = pluginRegistry.resolveRenderer(
    rendererState.rendererId,
    rendererState.isDevRenderer
  )

  // Build host API for renderer
  const host: RendererHostApi = useMemo(
    () => ({
      close: () => {
        clearPaneRenderer(paneId)
      },
      focusPane: (targetPaneId) => {
        setActivePaneId(targetPaneId)
      },
      updatePaneText: (targetPaneId, text) => {
        setPaneText(targetPaneId, text)
      },
      dispatch: (effects) => {
        applyEffects(stampDevEffects(effects, rendererState.isDevRenderer))
      },
    }),
    [paneId, clearPaneRenderer, setActivePaneId, setPaneText, rendererState.isDevRenderer]
  )

  // Build inputs for renderer (push model)
  // The renderer inputs declared in rendererState.rendererInputs are paneId references;
  // RendererHost resolves them to actual PaneInput objects with current text.
  const resolvedInputs = useResolvedRendererInputs(rendererState.rendererInputs, panes)

  if (!rendererEntry) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <span
          className="text-[12px]"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {t('renderer.notFound')}: {rendererState.rendererId}
        </span>
        <button
          className="text-[11px] px-2 py-1 rounded cursor-pointer"
          style={{
            background: 'var(--color-background-tertiary)',
            color: 'var(--color-text-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
          }}
          onClick={() => clearPaneRenderer(paneId)}
        >
          {t('close')}
        </button>
      </div>
    )
  }

  const RendererComponent = rendererEntry.contribution.component
  const surfaceId = `pane:${paneId}:renderer`
  const pluginId = rendererEntry.meta.pluginId

  return (
    <I18nNamespaceProvider value={pluginId}>
      <div className="flex-1 overflow-hidden h-full">
        <RendererComponent
          inputs={resolvedInputs}
          surfaceId={surfaceId}
          host={host}
        />
      </div>
    </I18nNamespaceProvider>
  )
}

function stampDevEffects(effects: FluxEffect[], isDev?: boolean): FluxEffect[] {
  if (!isDev) return effects
  return effects.map((effect) => {
    if (effect.type === 'pane.setRenderer') return { ...effect, _isDev: true }
    if (effect.type === 'panel.openV2') return { ...effect, _isDev: true }
    return effect
  })
}

/**
 * Resolve renderer inputs.
 * Inputs passed to pane.setRenderer can be:
 *   - A plain object with paneId references that should be resolved to PaneInput
 *   - Any other value passed through directly
 *
 * If rendererInputs contains paneId references (e.g., { original: paneId, modified: paneId }),
 * they are resolved to full PaneInput objects with the current pane text.
 */
function useResolvedRendererInputs(
  rendererInputs: unknown,
  panes: ReturnType<typeof useWorkspaceStore.getState>['panes']
): unknown {
  return useMemo(() => {
    if (!rendererInputs || typeof rendererInputs !== 'object') {
      return rendererInputs
    }

    const inputs = rendererInputs as Record<string, unknown>
    const resolved: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(inputs)) {
      // If the value looks like a PaneInput descriptor { kind: 'pane', paneId: string }
      if (
        value &&
        typeof value === 'object' &&
        (value as { kind?: unknown }).kind === 'pane' &&
        typeof (value as { paneId?: unknown }).paneId === 'string'
      ) {
        const descriptor = value as { kind: 'pane'; paneId: string }
        const pane = panes[descriptor.paneId]
        if (pane) {
          const paneInput: PaneInput = {
            kind: 'pane',
            paneId: descriptor.paneId,
            text: pane.text,
            title: pane.title,
            language: pane.language,
            stickyScroll: pane.stickyScroll === true,
          }
          resolved[key] = paneInput
        } else {
          resolved[key] = value
        }
      } else {
        resolved[key] = value
      }
    }

    return resolved
  }, [rendererInputs, panes])
}
