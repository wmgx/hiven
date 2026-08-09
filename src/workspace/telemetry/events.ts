/**
 * Telemetry event catalog — stable names for Agent reports and dashboards.
 *
 * Naming: domain.action[.detail]
 * - behavior: user intent / product action (no duration required)
 * - latency: timed work (durationMs required)
 * - perf: internal diagnostics (rank, debounce, native) — legacy labels OK
 */

export const TelemetryEvents = {
  // ── Launcher session ─────────────────────────────────────────────────────
  launcherOpen: 'behavior:launcher.open',
  launcherClose: 'behavior:launcher.close',
  launcherFirstPaint: 'latency:launcher.first_paint',

  // ── Search / query ───────────────────────────────────────────────────────
  /** Debounced live query (typing). */
  launcherQueryChange: 'behavior:launcher.query_change',
  /** Sticky draft restored after open. */
  launcherStickyRestore: 'behavior:launcher.sticky_restore',

  // ── List selection & execute ─────────────────────────────────────────────
  launcherItemSelect: 'behavior:launcher.item_select',
  launcherItemExecute: 'latency:launcher.item_execute',
  launcherSubmitInput: 'behavior:launcher.submit_input',
  launcherSubmitInputLatency: 'latency:launcher.submit_input',
  launcherChoiceActivate: 'behavior:launcher.choice_activate',
  launcherChoiceLatency: 'latency:launcher.choice_activate',
  launcherBack: 'behavior:launcher.back',
  launcherEnterCollectInput: 'behavior:launcher.enter_collect_input',
  launcherEnterParamInput: 'behavior:launcher.enter_param_input',

  // ── Object block / clipboard ─────────────────────────────────────────────
  clipboardRead: 'latency:clipboard.read',
  clipboardBlockAttach: 'behavior:clipboard.block_attach',
  clipboardBlockRemove: 'behavior:clipboard.block_remove',
  clipboardHintAttach: 'behavior:clipboard.hint_attach',
  objectActionExecute: 'behavior:object_action.execute',
  objectActionLatency: 'latency:object_action.execute',

  // ── Surfaces / windows ───────────────────────────────────────────────────
  surfaceOpen: 'behavior:surface.open',
  surfaceOpenLatency: 'latency:surface.open',
  surfaceWindowOpen: 'behavior:surface.window_open',
  hostSurfaceOpen: 'behavior:host_surface.open',

  // ── Paste / output ───────────────────────────────────────────────────────
  pasteText: 'behavior:paste.text',
  pasteLatency: 'latency:paste',
} as const

export type TelemetryEventName = (typeof TelemetryEvents)[keyof typeof TelemetryEvents]

export type TelemetryKind = 'behavior' | 'latency' | 'perf'
