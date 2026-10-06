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

  // ── Self-learning (passive observation) ──────────────────────────────────
  /** A shape-only event was recorded (per clipboard change; no raw text). */
  learningObserve: 'perf:learning.observe',
  /** A secret-like clipboard change was skipped (privacy confirmation). */
  learningSecretSkip: 'perf:learning.secret_skip',
  /** A reproducible transform pair was confirmed (the key "learning happened" signal). */
  learningPairVerified: 'behavior:learning.pair_verified',
  /** A transition was seen but no pure transform reproduced it. */
  learningPairMiss: 'perf:learning.pair_miss',
  /** Pure-transform runner table (re)built; runnerCount == 0 means pairing can never fire. */
  learningRunnersBuilt: 'perf:learning.runners_built',
  /** Time spent verifying a pair (dry-running candidate transforms). */
  learningVerifyLatency: 'latency:learning.pair_verify',
  /** A rule candidate is ready to propose to the user (P2). */
  learningProposalReady: 'behavior:learning.proposal_ready',
  /** The user accepted a proposal → a rule was learned (P2). */
  learningRuleAccepted: 'behavior:learning.rule_accepted',
  /** The user rejected a proposal → the cluster is suppressed (P2). */
  learningRuleRejected: 'behavior:learning.rule_rejected',
  /** The user deleted a learned rule from the management page (P2). */
  learningRuleDeleted: 'behavior:learning.rule_deleted',
  /** A navigation was passively observed and templatized (scenario D). */
  learningNavObserve: 'perf:learning.nav_observe',
  /** A discovered template was suppressed as already-covered (novelty guard). */
  learningProposalCovered: 'perf:learning.proposal_covered',
  /** A learned url-template rule fired (typed token → opened the page). */
  learningRuleFired: 'behavior:learning.rule_fired',
  /**
   * A rule was learned silently, with no user confirmation (the default path
   * since the proposal card was removed). Pair with `rule_fired` and
   * `rule_undone` to judge whether silent learning is guessing well: many
   * auto-learned + few fired = learning noise.
   */
  learningRuleAutoLearned: 'behavior:learning.rule_auto_learned',
  /** The user undid a newly-learned rule at fire time (badge → one-key undo). */
  learningRuleUndone: 'behavior:learning.rule_undone',
  /**
   * One full background auto-learn pass (candidate collection + induction +
   * apply). Runs on a 10-minute timer regardless of launcher state — this is
   * the label to check first if the launcher stutters roughly on that cadence.
   */
  learningAutoLearnPass: 'latency:learning.auto_learn_pass',
} as const

export type TelemetryEventName = (typeof TelemetryEvents)[keyof typeof TelemetryEvents]

export type TelemetryKind = 'behavior' | 'latency' | 'perf'
