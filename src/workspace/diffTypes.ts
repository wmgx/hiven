/**
 * Structural payload for two-side text compare handoff.
 *
 * This is a transport shape for launcher → text-diff plugin surface,
 * not a product Diff model. JSON semantic trees, dual-pane chrome, and
 * toolbar policy live inside the text-diff plugin.
 */

export type DiffSourcePayload = {
  sourceId: string
  kind: 'editor-pane' | 'clipboard' | 'empty'
  paneId?: string
  /**
   * Where a pane-backed source lives. Used so the text-diff plugin can
   * write edits back to Quick Editor (or legacy editor session) when bound.
   */
  origin?: 'editor' | 'quick-editor'
  title: string
  language?: string
  text?: string
}

/** @deprecated Prefer DiffSourcePayload — alias kept for gradual migration. */
export type DiffSource = DiffSourcePayload
