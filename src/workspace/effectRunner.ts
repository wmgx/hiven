/**
 * FluxText Workspace Extension - Effect Runner
 * Applies effects produced by commands to the workspace.
 * Handles surface conflict checking and transactional effect application.
 */

import type {
  FluxEffect,
  TextReplaceEffect,
  StatusEffect,
  PaneEffect,
  WorkspaceLayoutEffect,
  PresentationEffect,
  PanelEffect,
  MonacoEffect,
  SurfaceClaim,
  ConflictPolicy,
} from './types'
import { useWorkspaceStore } from './workspaceStore'
import { runtimeRegistry } from './runtimeRegistry'
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
  applyMonacoDiffUpdateOptions,
} from './monacoBridge'

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
        case 'workspace.layout':
        case 'workspace.split':
          applyWorkspaceEffect(effect)
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
        case 'monaco.decorate':
        case 'monaco.updateOptions':
        case 'monaco.diff.updateOptions':
          applyMonacoEffect(effect)
          result.applied.push(effect)
          break
        default:
          result.errors.push(`Unsupported effect type: ${(effect as any).type}`)
      }
    } catch (e: any) {
      result.errors.push(`Effect ${effect.type} failed: ${e.message}`)
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
      state.setPaneText(paneId, effect.text)
    } else {
      state.setPaneText(paneId, effect.text)
    }
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
      })
      break
    case 'pane.close':
      ws.closePane(effect.paneId)
      break
    case 'pane.focus':
      ws.setActivePaneId(effect.paneId)
      break
    case 'pane.update':
      if (effect.patch.text !== undefined) ws.setPaneText(effect.paneId, effect.patch.text)
      if (effect.patch.title !== undefined) ws.updatePaneTitle(effect.paneId, effect.patch.title)
      if (effect.patch.language !== undefined) ws.updatePaneLanguage(effect.paneId, effect.patch.language)
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
  console.log(`[FluxText ${effect.level}] ${effect.message}`)
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
    case 'monaco.diff.updateOptions':
      applyMonacoDiffUpdateOptions(effect.sessionId, effect.options)
      break
  }
}
