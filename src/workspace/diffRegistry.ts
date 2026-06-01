/**
 * FluxText - Diff Registry
 * Registry for diff renderers. Commands select a renderer based on input kind.
 */

import type { DiffInputKind } from './paneSelection'

export type DiffDisplayMode = 'side-by-side' | 'inline' | 'tree' | 'summary'

export type DiffInput = {
  role: 'original' | 'modified'
  paneId: string
  title: string
  text: string
  language?: string
  kind: DiffInputKind
}

export type DiffCapabilityResult = {
  ok: boolean
  confidence: 'high' | 'medium' | 'low'
  reason?: string
}

export type DiffRendererDef = {
  id: string
  title: string
  supportedInputCounts: number[]
  supportedKinds: DiffInputKind[]
  supportedModes: DiffDisplayMode[]
  canHandle(inputs: DiffInput[]): DiffCapabilityResult
}

// ─── Registry ───────────────────────────────────────────────────────────────

const renderers: Map<string, DiffRendererDef> = new Map()

export function registerDiffRenderer(def: DiffRendererDef) {
  renderers.set(def.id, def)
}

export function getDiffRenderer(id: string): DiffRendererDef | undefined {
  return renderers.get(id)
}

export function getAllDiffRenderers(): DiffRendererDef[] {
  return [...renderers.values()]
}

/**
 * Select the best renderer for given inputs.
 * If diffType is specified and not 'auto', use that directly.
 * Otherwise, find the renderer with highest confidence that can handle the inputs.
 */
export function selectDiffRenderer(inputs: DiffInput[], preferredType?: string): DiffRendererDef | undefined {
  if (preferredType && preferredType !== 'auto') {
    const preferred = renderers.get(preferredType)
    if (preferred) {
      const result = preferred.canHandle(inputs)
      if (result.ok) return preferred
    }
  }

  // Auto-select: find best match by confidence
  let best: { renderer: DiffRendererDef; confidence: number } | null = null
  const confidenceOrder = { high: 3, medium: 2, low: 1 }

  for (const renderer of renderers.values()) {
    const result = renderer.canHandle(inputs)
    if (result.ok) {
      const score = confidenceOrder[result.confidence]
      if (!best || score > best.confidence) {
        best = { renderer, confidence: score }
      }
    }
  }

  return best?.renderer
}

/**
 * Build DiffInput array from pane IDs.
 */
export function buildDiffInputs(
  panes: Record<string, { id: string; title: string; text: string; language?: string }>,
  originalPaneId: string,
  modifiedPaneId: string,
  inferKindFn: (text: string) => DiffInputKind
): DiffInput[] {
  const origPane = panes[originalPaneId]
  const modPane = panes[modifiedPaneId]
  if (!origPane || !modPane) return []

  return [
    {
      role: 'original',
      paneId: originalPaneId,
      title: origPane.title,
      text: origPane.text,
      language: origPane.language,
      kind: inferKindFn(origPane.text),
    },
    {
      role: 'modified',
      paneId: modifiedPaneId,
      title: modPane.title,
      text: modPane.text,
      language: modPane.language,
      kind: inferKindFn(modPane.text),
    },
  ]
}

// ─── Built-in Renderer Definitions ─────────────────────────────────────────

// Register text-line-diff (Monaco DiffEditor)
registerDiffRenderer({
  id: 'text-line-diff',
  title: 'Text Line Diff',
  supportedInputCounts: [2],
  supportedKinds: ['text', 'json', 'csv', 'xml', 'unknown'],
  supportedModes: ['side-by-side', 'inline'],
  canHandle(inputs) {
    if (inputs.length !== 2) return { ok: false, confidence: 'low', reason: 'Requires exactly 2 inputs' }
    return { ok: true, confidence: 'medium' }
  },
})

// Register json-object-diff
registerDiffRenderer({
  id: 'json-object-diff',
  title: 'JSON Object Diff',
  supportedInputCounts: [2],
  supportedKinds: ['json'],
  supportedModes: ['side-by-side', 'inline', 'summary'],
  canHandle(inputs) {
    if (inputs.length !== 2) return { ok: false, confidence: 'low', reason: 'Requires exactly 2 inputs' }
    // Both inputs must be JSON
    const allJson = inputs.every(i => i.kind === 'json')
    if (!allJson) return { ok: false, confidence: 'low', reason: 'Both inputs must be valid JSON' }
    return { ok: true, confidence: 'high' }
  },
})
