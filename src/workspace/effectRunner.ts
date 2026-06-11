/**
 * hiven Workspace Extension - Effect Runner
 * Applies effects produced by commands to the workspace.
 * Handles surface conflict checking and transactional effect application.
 */

import type {
  FluxEffect,
  TextReplaceEffect,
  StatusEffect,
  PaneEffect,
  PaneRendererEffect,
  WorkspaceLayoutEffect,
  AppEffect,
  PresentationEffect,
  PanelEffect,
  PanelV2Effect,
  MonacoEffect,
  SurfaceClaim,
  ConflictPolicy,
} from './types'
import { useWorkspaceStore } from './workspaceStore'
import { runtimeRegistry } from './runtimeRegistry'
import { useAppStore } from '../store'
import {
  detectConflicts,
  resolveConflict,
  registerOccupancy,
  releaseOccupancy,
  paneSurfaceId,
  panelSurfaceId,
  type ConflictInfo,
} from './surfaceCoordinator'
import {
  applyMonacoDecorate,
  applyMonacoUpdateOptions,
} from './monacoBridge'
import { showToast } from './toast'
import { pluginRegistry } from './pluginRegistry'

export interface EffectRunnerResult {
  applied: FluxEffect[]
  errors: string[]
  pendingConfirmations?: ConflictInfo[]
}

/**
 * Apply a list of effects to the workspace.
 * Processing order:
 * 1. Parse all effects to determine surface claims
 * 2. Check exclusive conflicts
 * 3. Resolve conflicts based on policy (reject/replace/ask)
 * 4. If user confirmation needed, pause (return pendingConfirmations)
 * 5. Close existing occupancies per ExitPolicy
 * 6. Apply new effects
 * 7. Record new occupancies
 */
export function applyEffects(
  effects: FluxEffect[],
  conflictPolicy: ConflictPolicy = 'ask'
): EffectRunnerResult {
  const result: EffectRunnerResult = { applied: [], errors: [] }

  // Step 1-3: Check for surface conflicts (for presentation/panel effects)
  const surfaceEffects = effects.filter(
    (e) => e.type === 'presentation.open' || e.type === 'panel.open'
  )

  if (surfaceEffects.length > 0) {
    const claims = extractSurfaceClaims(surfaceEffects)
    const ownerId = `command:${Date.now()}`
    const conflicts = detectConflicts(claims, ownerId)

    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        const resolution = resolveConflict(conflict, conflictPolicy)
        if (resolution === 'reject') {
          result.errors.push(`Conflict rejected: ${conflict.conflictingSurface}`)
          return result
        }
        if (resolution === 'ask') {
          result.pendingConfirmations = conflicts
          return result
        }
        // 'proceed' -> close existing occupancy
        releaseOccupancy(conflict.existingOccupancy.id)
      }
    }
  }

  // Step 4-6: Apply effects
  for (const effect of effects) {
    try {
      switch (effect.type) {
        case 'text.replace':
          applyTextReplace(effect)
          result.applied.push(effect)
          break
        case 'pane.create':
        case 'pane.close':
        case 'pane.focus':
        case 'pane.update':
          applyPaneEffect(effect)
          result.applied.push(effect)
          break
        case 'pane.setRenderer':
        case 'pane.clearRenderer':
          applyPaneRendererEffect(effect)
          result.applied.push(effect)
          break
        case 'workspace.layout':
        case 'workspace.split':
          applyWorkspaceEffect(effect)
          result.applied.push(effect)
          break
        case 'app.showMainPanel':
          applyAppEffect(effect)
          result.applied.push(effect)
          break
        case 'status.message':
          applyStatus(effect)
          result.applied.push(effect)
          break
        case 'presentation.open':
        case 'presentation.close':
        case 'presentation.update':
          applyPresentationEffect(effect)
          result.applied.push(effect)
          break
        case 'panel.open':
        case 'panel.close':
        case 'panel.update':
          applyPanelEffect(effect)
          result.applied.push(effect)
          break
        case 'panel.openV2':
        case 'panel.closeV2':
          applyPanelV2Effect(effect)
          result.applied.push(effect)
          break
        case 'monaco.decorate':
        case 'monaco.updateOptions':
          applyMonacoEffect(effect)
          result.applied.push(effect)
          break
        default:
          result.errors.push(`Unsupported effect type: ${(effect as { type?: string }).type ?? 'unknown'}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      result.errors.push(`Effect ${effect.type} failed: ${message}`)
    }
  }

  return result
}

/**
 * Apply effects after user confirms conflict resolution.
 */
export function applyEffectsAfterConfirmation(
  effects: FluxEffect[],
  conflictsToReplace: ConflictInfo[]
): EffectRunnerResult {
  // Release all conflicting occupancies
  for (const conflict of conflictsToReplace) {
    releaseOccupancy(conflict.existingOccupancy.id)
  }
  // Now apply normally with 'replace' policy to skip re-checking
  return applyEffects(effects, 'replace')
}

// ─── Surface Claim Extraction ───────────────────────────────────────────────

function extractSurfaceClaims(effects: FluxEffect[]): SurfaceClaim[] {
  const claims: SurfaceClaim[] = []

  for (const effect of effects) {
    if (effect.type === 'presentation.open') {
      // Presentation claims pane renderers as exclusive
      for (const paneId of effect.targetPaneIds) {
        claims.push({
          surfaceId: paneSurfaceId(paneId, 'renderer'),
          mode: 'exclusive',
        })
      }
    } else if (effect.type === 'panel.open') {
      // Panel claims its placement surface
      const placement = effect.placement
      if (placement === 'bottom' || placement === 'right' || placement === 'left') {
        claims.push({
          surfaceId: panelSurfaceId(placement),
          mode: 'exclusive',
        })
      }
    }
  }

  return claims
}

// ─── Effect Handlers ────────────────────────────────────────────────────────

function applyTextReplace(effect: TextReplaceEffect) {
  const state = useWorkspaceStore.getState()

  if (effect.target === 'active-input') {
    const activePaneId = state.activePaneId
    const editor = runtimeRegistry.getCodeEditor(activePaneId)

    if (editor) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        editor.pushUndoStop()
        editor.executeEdits('effect-runner', [{
          range: sel,
          text: effect.text,
        }])
        editor.pushUndoStop()
        const newText = editor.getModel()?.getValue() || ''
        state.setPaneText(activePaneId, newText)
      } else {
        editor.pushUndoStop()
        const model = editor.getModel()
        if (model) {
          const fullRange = model.getFullModelRange()
          editor.executeEdits('effect-runner', [{
            range: fullRange,
            text: effect.text,
          }])
        }
        editor.pushUndoStop()
        state.setPaneText(activePaneId, effect.text)
      }
    } else {
      state.setActivePaneText(effect.text)
    }
  } else {
    const { paneId, range } = effect.target
    const editor = runtimeRegistry.getCodeEditor(paneId)

    if (editor && range) {
      editor.pushUndoStop()
      editor.executeEdits('effect-runner', [{
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.endLineNumber,
          endColumn: range.endColumn,
        },
        text: effect.text,
      }])
      editor.pushUndoStop()
      const newText = editor.getModel()?.getValue() || ''
      state.setPaneText(paneId, newText)
    } else if (editor) {
      state.setPaneText(paneId, effect.text)
    } else {
      state.setPaneText(paneId, effect.text)
    }
  }
}

function applyAppEffect(effect: AppEffect) {
  const app = useAppStore.getState()
  switch (effect.type) {
    case 'app.showMainPanel':
      app.setActiveView('editor')
      app.setCommandPaletteOpen(false)
      app.setGlobalLauncherOpen(false)
      break
  }
}

function applyPaneEffect(effect: PaneEffect) {
  const ws = useWorkspaceStore.getState()

  switch (effect.type) {
    case 'pane.create':
      ws.createPane({
        text: effect.pane.text || '',
        title: effect.pane.title,
        language: effect.pane.language,
        focus: effect.focus,
        direction: effect.direction,
      })
      break
    case 'pane.close':
      if (effect.paneId) {
        ws.closePane(effect.paneId)
      } else {
        ws.closeActiveSurfaceOrPane()
        const newActivePaneId = useWorkspaceStore.getState().activePaneId
        const editor = runtimeRegistry.getCodeEditor(newActivePaneId)
        if (editor) {
          useAppStore.getState().setEditorInstance(editor)
        }
      }
      break
    case 'pane.focus':
      ws.setActivePaneId(effect.paneId)
      break
    case 'pane.update':
      if (effect.patch.text !== undefined) ws.setPaneText(effect.paneId, effect.patch.text)
      if (effect.patch.title !== undefined) ws.updatePaneTitle(effect.paneId, effect.patch.title)
      if (effect.patch.language !== undefined) ws.updatePaneLanguage(effect.paneId, effect.patch.language)
      if (effect.patch.detectedLanguage !== undefined) ws.updatePaneDetectedLanguage(effect.paneId, effect.patch.detectedLanguage)
      if (effect.patch.languageSource !== undefined) ws.updatePaneLanguageSource(effect.paneId, effect.patch.languageSource)
      if (effect.patch.stickyScroll !== undefined) ws.updatePaneStickyScroll(effect.paneId, effect.patch.stickyScroll)
      break
  }
}

function applyWorkspaceEffect(effect: WorkspaceLayoutEffect) {
  const ws = useWorkspaceStore.getState()

  switch (effect.type) {
    case 'workspace.layout':
      ws.setLayout(effect.layout)
      break
    case 'workspace.split': {
      const activePane = ws.panes[ws.activePaneId]
      ws.createPane({
        text: '',
        language: activePane?.language || 'plaintext',
        focus: true,
      })
      break
    }
  }
}

function applyStatus(effect: StatusEffect) {
  console.log(`[hiven ${effect.level}] ${effect.message}`)
  const defaultDuration = effect.level === 'error' ? 5000 : effect.level === 'warning' ? 4000 : 3000
  showToast(effect.message, effect.level, {
    persistent: effect.persistent,
    durationMs: effect.durationMs ?? defaultDuration,
  })
}

// ─── Plugin Effect Handlers ──────────────────────────────────────────────────

function applyPaneRendererEffect(effect: PaneRendererEffect) {
  const ws = useWorkspaceStore.getState()

  if (effect.type === 'pane.setRenderer') {
    // Validate renderer exists — prefer dev registry if effect was dispatched from a dev command
    const rendererEntry = pluginRegistry.resolveRenderer(effect.renderer, effect._isDev)
    if (!rendererEntry) {
      // Emit status warning, do not throw
      showToast(`Renderer "${effect.renderer}" not found`, 'warning')
      return
    }

    ws.setPaneRenderer(effect.paneId, {
      rendererId: effect.renderer,
      rendererInputs: effect.inputs,
      ownerPluginId: effect.ownerPluginId ?? rendererEntry.meta.pluginId,
      ownerContributionId: effect.ownerContributionId,
      isDevRenderer: effect._isDev,
    })
  } else if (effect.type === 'pane.clearRenderer') {
    ws.clearPaneRenderer(effect.paneId)
  }
}

function applyPanelV2Effect(effect: PanelV2Effect) {
  const ws = useWorkspaceStore.getState()

  if (effect.type === 'panel.openV2') {
    const panelEntry = pluginRegistry.resolvePanel(effect.panelId, effect._isDev)
    if (!panelEntry) {
      showToast(`Panel "${effect.panelId}" not found`, 'warning')
      return
    }

    const placement = effect.placement ?? panelEntry.contribution.defaultPlacement ?? 'bottom'
    const existing = ws.panelInstancesV2[effect.panelId]
    if (existing) {
      ws.openPanelV2({
        ...existing,
        placement: effect.placement ?? existing.placement ?? placement,
        inputs: effect.inputs ?? existing.inputs,
        scope: effect.scope ?? existing.scope,
        title: effect.title ?? panelEntry.contribution.title,
        ownerPluginId: effect.ownerPluginId ?? panelEntry.meta.pluginId,
        isDevPanel: effect._isDev ?? existing.isDevPanel,
      })
      return
    }

    ws.openPanelV2({
      panelId: effect.panelId,
      placement,
      inputs: effect.inputs ?? null,
      scope: effect.scope,
      title: effect.title ?? panelEntry.contribution.title,
      ownerPluginId: effect.ownerPluginId ?? panelEntry.meta.pluginId,
      isDevPanel: effect._isDev,
    })
  } else if (effect.type === 'panel.closeV2') {
    ws.closePanelV2(effect.panelId)
  }
}

function applyPresentationEffect(effect: PresentationEffect) {
  const ws = useWorkspaceStore.getState()

  switch (effect.type) {
    case 'presentation.open': {
      const sessionId = effect.sessionId || `session-${Date.now().toString(36)}`
      const session = {
        id: sessionId,
        renderer: effect.renderer,
        mode: effect.mode,
        targetPaneIds: effect.targetPaneIds,
        statusLabel: `${effect.renderer}: ${effect.targetPaneIds.map(id => ws.panes[id]?.title || id).join(' ↔ ')}`,
        live: true,
        editable: true,
        options: effect.options || {},
      }
      ws.openPresentation(session)

      // Register occupancy
      registerOccupancy({
        id: `presentation:${sessionId}`,
        ownerId: `presentation:${sessionId}`,
        ownerKind: 'presentation',
        surfaces: effect.targetPaneIds.map(paneId => ({
          surfaceId: paneSurfaceId(paneId, 'renderer'),
          mode: 'exclusive' as const,
        })),
        title: session.statusLabel || effect.renderer,
        statusLabel: session.statusLabel,
        exitPolicy: {
          closeBehavior: 'dispose-only',
          preservesPaneText: true,
        },
      })
      break
    }
    case 'presentation.close': {
      const occupancyId = `presentation:${effect.sessionId}`
      releaseOccupancy(occupancyId)
      ws.closePresentation(effect.sessionId)
      break
    }
    case 'presentation.update': {
      ws.updatePresentationOptions(effect.sessionId, effect.options)
      break
    }
  }
}

function applyPanelEffect(effect: PanelEffect) {
  const ws = useWorkspaceStore.getState()

  switch (effect.type) {
    case 'panel.open': {
      const instanceId = `panel-${effect.panelId}-${Date.now().toString(36)}`

      // Check if same panel is already open (reuse)
      const existing = Object.values(ws.panels).find(p => p.panelId === effect.panelId)
      if (existing) {
        // Reuse existing panel, just focus it
        return
      }

      const instance = {
        id: instanceId,
        panelId: effect.panelId,
        placement: effect.placement,
        scope: effect.scope || { type: 'workspace' as const },
        bind: effect.bind,
        title: effect.title || effect.panelId,
        ownerId: `panel:${instanceId}`,
      }
      ws.openPanel(instance)

      // Register occupancy
      const placement = effect.placement
      if (placement === 'bottom' || placement === 'right' || placement === 'left') {
        registerOccupancy({
          id: `panel:${instanceId}`,
          ownerId: `panel:${instanceId}`,
          ownerKind: 'panel',
          surfaces: [{
            surfaceId: panelSurfaceId(placement),
            mode: 'exclusive',
          }],
          title: instance.title,
          statusLabel: instance.title,
          exitPolicy: {
            closeBehavior: 'dispose-only',
            preservesPaneText: true,
          },
        })
      }
      break
    }
    case 'panel.close': {
      const occupancyId = `panel:${effect.instanceId}`
      releaseOccupancy(occupancyId)
      ws.closePanel(effect.instanceId)
      break
    }
    case 'panel.update': {
      ws.updatePanel(effect.instanceId, effect.props)
      break
    }
  }
}

function applyMonacoEffect(effect: MonacoEffect) {
  switch (effect.type) {
    case 'monaco.decorate':
      applyMonacoDecorate(effect.paneId, effect.decorations, effect.owner)
      break
    case 'monaco.updateOptions':
      applyMonacoUpdateOptions(effect.paneId, effect.options)
      break
  }
}
