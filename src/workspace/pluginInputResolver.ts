/**
 * hiven Plugin System - Plugin Input Resolver
 * Resolves CommandContribution inputs based on InputResolution strategy.
 *
 * Strategies:
 *   use-active:    Use the active pane / active text selection
 *   auto-fill:     Automatically fill from current workspace panes
 *   always-prompt: Always show a picker for inputs
 *
 * Fallback:
 *   prompt: Show picker if auto-fill fails
 *   fail:   Send status.message error if auto-fill fails, don't throw
 */

import type { InputSlot, InputResolution, ResolvedInputs, PaneInput, TextInput } from './pluginTypes'
import { useWorkspaceStore } from './workspaceStore'
import { runtimeRegistry } from './runtimeRegistry'
import { showToast } from './toast'

export type InputResolveResult =
  | { ok: true; inputs: ResolvedInputs }
  | { ok: false; reason: 'prompt'; slots: InputSlot[] }
  | { ok: false; reason: 'needs-clipboard'; slots: InputSlot[] }
  | { ok: false; reason: 'fail'; message: string }

export type ResolverContext = {
  clipboardText?: string
}

/**
 * Resolve inputs for a CommandContribution.
 * Returns the resolved inputs or signals that a prompt is needed.
 */
export function resolvePluginInputs(
  slots: InputSlot[],
  resolution: InputResolution,
  context?: ResolverContext
): InputResolveResult {
  if (!slots || slots.length === 0) {
    return { ok: true, inputs: {} }
  }

  const state = useWorkspaceStore.getState()

  switch (resolution.strategy) {
    case 'use-active':
      return resolveUseActive(slots, resolution, state, context)
    case 'auto-fill':
      return resolveAutoFill(slots, resolution, state, context)
    case 'always-prompt':
      return { ok: false, reason: 'prompt', slots }
    default:
      return { ok: true, inputs: {} }
  }
}

// ─── Strategy: use-active ─────────────────────────────────────────────────────

function resolveUseActive(
  slots: InputSlot[],
  resolution: InputResolution,
  state: ReturnType<typeof useWorkspaceStore.getState>,
  context?: ResolverContext
): InputResolveResult {
  const inputs: ResolvedInputs = {}
  const activePaneId = state.activePaneId
  const activePane = state.panes[activePaneId]

  for (const slot of slots) {
    if (slot.kind === 'clipboard') {
      if (context?.clipboardText === undefined) {
        return { ok: false, reason: 'needs-clipboard', slots }
      }
      const clipboardInput: TextInput = { kind: 'text', text: context.clipboardText, paneId: undefined }
      inputs[slot.key] = clipboardInput
      continue
    }
    if (slot.kind === 'text') {
      // Try to get selected text first, then fall back to whole pane
      const editor = runtimeRegistry.getCodeEditor(activePaneId)
      let text = activePane?.text || ''
      let hasSelection = false

      if (editor) {
        const sel = editor.getSelection()
        if (sel && !sel.isEmpty()) {
          const selectedText = editor.getModel()?.getValueInRange(sel) || ''
          text = selectedText || text
          hasSelection = selectedText.length > 0
        }
      }

      const textInput: TextInput = { kind: 'text', text, paneId: hasSelection ? undefined : activePaneId }
      inputs[slot.key] = textInput
    } else if (slot.kind === 'pane') {
      if (!activePane) {
        if (slot.required) {
          return handleFallback(resolution, slots, `No active pane for input "${slot.key}"`)
        }
        continue
      }

      const paneInput: PaneInput = {
        kind: 'pane',
        paneId: activePaneId,
        text: activePane.text,
        title: activePane.title,
        language: activePane.language,
        stickyScroll: activePane.stickyScroll === true,
      }
      inputs[slot.key] = paneInput
    }
  }

  return { ok: true, inputs }
}

// ─── Strategy: auto-fill ──────────────────────────────────────────────────────

function resolveAutoFill(
  slots: InputSlot[],
  resolution: InputResolution,
  state: ReturnType<typeof useWorkspaceStore.getState>,
  context?: ResolverContext
): InputResolveResult {
  const inputs: ResolvedInputs = {}
  const { paneOrder, panes, activePaneId, previousActivePaneId } = state

  // Resolve clipboard slots first
  const clipboardSlots = slots.filter((s) => s.kind === 'clipboard')
  for (const slot of clipboardSlots) {
    if (context?.clipboardText === undefined) {
      return { ok: false, reason: 'needs-clipboard', slots }
    }
    const clipboardInput: TextInput = { kind: 'text', text: context.clipboardText, paneId: undefined }
    inputs[slot.key] = clipboardInput
  }

  // Only pass non-clipboard slots to further resolution
  const nonClipboardSlots = slots.filter((s) => s.kind !== 'clipboard')

  const paneSlots = nonClipboardSlots.filter((s) => s.kind === 'pane')
  const textSlots = nonClipboardSlots.filter((s) => s.kind === 'text')

  // Resolve text slots from active pane
  for (const slot of textSlots) {
    const pane = panes[activePaneId]
    if (!pane && slot.required) {
      return handleFallback(resolution, slots, `No active pane for text input "${slot.key}"`)
    }
    const textInput: TextInput = { kind: 'text', text: pane?.text || '', paneId: activePaneId }
    inputs[slot.key] = textInput
  }

  // Resolve pane slots
  if (paneSlots.length === 0) {
    return { ok: true, inputs }
  }

  if (paneSlots.length === 1) {
    // Single pane input → use active pane
    const pane = panes[activePaneId]
    if (!pane && paneSlots[0].required) {
      return handleFallback(resolution, slots, 'No active pane available')
    }
    if (pane) {
      inputs[paneSlots[0].key] = {
        kind: 'pane',
        paneId: activePaneId,
        text: pane.text,
        title: pane.title,
        language: pane.language,
        stickyScroll: pane.stickyScroll === true,
      }
    }
    return { ok: true, inputs }
  }

  if (paneSlots.length === 2) {
    // Two pane inputs (e.g., diff: original + modified)
    if (paneOrder.length === 1) {
      // Only 1 pane → can't auto-fill 2 slots
      return handleFallback(resolution, slots, 'Need 2 panes for this command. Please open another pane first.')
    }

    if (paneOrder.length === 2) {
      // Exactly 2 panes → use active pane first, then the other pane.
      const activePaneIndex = paneOrder.indexOf(activePaneId)
      const firstPaneId = activePaneIndex >= 0 ? activePaneId : paneOrder[0]
      const otherPaneId = paneOrder.find((paneId) => paneId !== firstPaneId) ?? paneOrder[1]
      const activePane = panes[firstPaneId]
      const otherPane = panes[otherPaneId]
      inputs[paneSlots[0].key] = { kind: 'pane', paneId: firstPaneId, text: activePane?.text || '', title: activePane?.title, language: activePane?.language, stickyScroll: activePane?.stickyScroll === true }
      inputs[paneSlots[1].key] = { kind: 'pane', paneId: otherPaneId, text: otherPane?.text || '', title: otherPane?.title, language: otherPane?.language, stickyScroll: otherPane?.stickyScroll === true }
      return { ok: true, inputs }
    }

    // 3+ panes → use previousActivePaneId + activePaneId if both exist, else prompt
    if (previousActivePaneId && previousActivePaneId !== activePaneId && panes[previousActivePaneId]) {
      inputs[paneSlots[0].key] = {
        kind: 'pane',
        paneId: previousActivePaneId,
        text: panes[previousActivePaneId]!.text,
        title: panes[previousActivePaneId]!.title,
        language: panes[previousActivePaneId]!.language,
        stickyScroll: panes[previousActivePaneId]!.stickyScroll === true,
      }
      inputs[paneSlots[1].key] = {
        kind: 'pane',
        paneId: activePaneId,
        text: panes[activePaneId]!.text,
        title: panes[activePaneId]!.title,
        language: panes[activePaneId]!.language,
        stickyScroll: panes[activePaneId]!.stickyScroll === true,
      }
      return { ok: true, inputs }
    }

    return handleFallback(resolution, slots, 'Please select 2 panes to compare')
  }

  // More than 2 pane slots: always prompt
  return { ok: false, reason: 'prompt', slots }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleFallback(
  resolution: InputResolution,
  slots: InputSlot[],
  message: string
): InputResolveResult {
  if (resolution.fallback === 'prompt') {
    return { ok: false, reason: 'prompt', slots }
  }
  // fallback: 'fail'
  showToast(message, 'error')
  return { ok: false, reason: 'fail', message }
}

/**
 * Build a default CommandContext for a resolved set of inputs.
 * Used when running a CommandContribution's run() function.
 */
export function buildPluginCommandContext(
  inputs: ResolvedInputs,
  params: Record<string, unknown>
) {
  return { inputs, params }
}
