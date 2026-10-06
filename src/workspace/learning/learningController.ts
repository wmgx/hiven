/**
 * Self-learning · controller (P2b, impure orchestrator — no product semantics).
 *
 * The one place that touches the learning store to answer "is there a rule to
 * propose?" and to persist accept / reject. Pure cores (cluster / proposals) do
 * the logic; this does the IndexedDB IO and telemetry.
 *
 * Also installs a read-only devtools hook `window.__hivenLearning` (mirrors
 * `window.__hivenLauncherPerf`) so the learning pipeline is verifiable against
 * real data before the proposal card (P2c) exists. Dev tool → not user-facing,
 * no i18n.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §8 (P2).
 */

import { TelemetryEvents, measureLatency, trackBehavior, trackPerf } from '../telemetry'
import { scheduleIdleWork } from '../scheduleIdleWork'
import { selectProposableCandidates, type RuleCandidate } from './cluster'
import { isShapeCovered, representativeTokens, type CoverageProbe } from './coverage'
import { extractFeatures, featureSignature } from './features'
import { refreshLearnedUrlRules } from './fire'
import { buildPureTransformRunners, runLearnedChain } from './registryRunners'
import { ruleFromCandidate, selectAutoLearnable, sourceScopedTemplateToCandidate, templateToCandidate } from './proposals'
import { offerLearnedRule } from './ruleSink'
import {
  addSuppression,
  countEventSigs,
  deleteRule,
  putRule,
  purgeUrlTemplateLearningOnce,
  queryAllPairs,
  queryAllRules,
  queryAllSuppressions,
  queryNavigations,
  queryPathObservations,
  removeSuppression,
  type LearnedRule,
  type Suppression,
} from './store'
import { classifyTokenSlot, induceSourceScopedTemplates, induceUrlTemplates, type DiscoveredTemplate } from './urlTemplate'
import { buildTemplateFromPositions, induceVariablePositions } from './positionVariance'
import { getRecentPathSample } from './navigationSensor'

/**
 * A discovered url-template is net-new only if a representative slot token isn't
 * already handled by an existing capability (the user's web-open rules, etc.).
 * The novelty guard — the learner never re-proposes what you already have.
 */
function isCandidateNovel(candidate: RuleCandidate): boolean {
  if (candidate.transform.kind !== 'url-template' || candidate.matcher.kind !== 'token') return true
  const slotKind = candidate.matcher.tokenKind
  const host = candidate.transform.template.split('/')[0] ?? ''
  const probes: CoverageProbe[] = representativeTokens(slotKind).map((token) => ({ token, host, slotKind }))
  const covered = isShapeCovered(probes)
  if (covered) trackPerf(TelemetryEvents.learningProposalCovered, { slotKind, host })
  return !covered
}

/**
 * All candidates the observer currently has evidence for, strongest first,
 * minus the ones already learned or explicitly suppressed.
 */
async function collectCandidates(): Promise<{
  candidates: RuleCandidate[]
  learnedKeys: string[]
  suppressedKeys: string[]
}> {
  const [pairs, eventSigCounts, rules, suppressions, navs] = await Promise.all([
    queryAllPairs(),
    countEventSigs(),
    queryAllRules(),
    queryAllSuppressions(),
    queryNavigations(),
  ])
  // Merge both discovery sources: verified transform clusters + navigation
  // templates (self-discovery), strongest evidence first.
  const candidates = [
    ...selectProposableCandidates(pairs, eventSigCounts),
    ...induceUrlTemplates(navs).map(templateToCandidate),
    ...induceSourceScopedTemplates(navs).map(sourceScopedTemplateToCandidate),
    ...(await positionVarianceCandidates()),
  ]
    // URL shape alone is not enough intent evidence: the same opaque ID shape
    // occurs in checkout tokens, auth links, logs, tickets, and many other sites.
    .filter((candidate) => candidate.transform.kind !== 'url-template')
    .filter(isCandidateNovel)
    .sort((a, b) => {
      if (b.distinctInputs !== a.distinctInputs) return b.distinctInputs - a.distinctInputs
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount
      return b.lastTs - a.lastTs
    })
  return {
    candidates,
    learnedKeys: rules.map((r) => r.clusterKey),
    suppressedKeys: suppressions.map((s) => s.clusterKey),
  }
}

/**
 * Candidates from position-variance induction — the text-variable paths the
 * shape heuristic cannot see (`github.com/anthropics/{repo}`).
 *
 * Two independent judgements, deliberately kept apart:
 *   1. WHICH positions vary — decided across samples, by hash equality only.
 *   2. WHETHER a varying position can safely fire — decided by the shape of its
 *      actual value, via the same classifier the fire path uses.
 *
 * (2) is what stops this from producing catch-all rules. A position holding bare
 * words (`react`, `core`) varies perfectly well, but a rule keyed on it would
 * fire on any word the user typed, so it is dropped. Only positions whose values
 * classify as a real token shape survive.
 */
async function positionVarianceCandidates(): Promise<RuleCandidate[]> {
  const observations = await queryPathObservations()
  if (observations.length === 0) return []

  const candidates: RuleCandidate[] = []
  for (const shape of induceVariablePositions(observations)) {
    // Needs one concrete path to recover the literal constants.
    const sample = getRecentPathSample(shape.host, shape.segmentCount)
    if (!sample) continue

    const slotKinds: string[] = []
    let fireable = true
    for (const index of shape.variableIndices) {
      const kind = classifyTokenSlot(sample.segments[index] ?? '')
      if (!kind) {
        fireable = false
        break
      }
      slotKinds.push(kind)
    }
    if (!fireable) continue

    const template = buildTemplateFromPositions(
      shape.host,
      sample.segments,
      shape.variableIndices,
      slotKinds,
    )
    if (!template) continue

    // Single-slot only: the reverse-fire path substitutes one typed query.
    if (slotKinds.length !== 1) continue

    candidates.push({
      clusterKey: `url:${template}`,
      matcher: { kind: 'token', tokenKind: slotKinds[0] },
      transform: { kind: 'url-template', template, slotKind: slotKinds[0] },
      sampleCount: shape.observations,
      distinctInputs: shape.distinctPerIndex[shape.variableIndices[0]] ?? 0,
      firstTs: shape.firstTs,
      lastTs: shape.lastTs,
    })
  }
  return candidates
}

/** Candidates that would be learned next — devtools/inspection only. */
export async function getPendingProposals(): Promise<RuleCandidate[]> {
  const { candidates, learnedKeys, suppressedKeys } = await collectCandidates()
  return selectAutoLearnable(candidates, { learnedKeys, suppressedKeys })
}

/**
 * Silently learn whatever there is now enough evidence for — no proposal, no
 * confirmation. Returns how many rules were learned.
 *
 * This replaces the proposal card. Rules land weak (see AUTO_LEARN_INITIAL_STRENGTH),
 * announce themselves the first few times they FIRE (where undo is one key away),
 * and decay back out on their own if never used. Learning a cluster removes it
 * from the pool permanently, which is what stops the old repeat-forever loop.
 */
export async function autoLearnNow(now: number = Date.now()): Promise<number> {
  // The periodic pass also owns persisted-rule pruning, even when nothing new is learnable.
  await refreshLearnedUrlRules()
  const { candidates, learnedKeys, suppressedKeys } = await collectCandidates()
  const learnable = selectAutoLearnable(candidates, { learnedKeys, suppressedKeys })
  if (learnable.length === 0) return 0

  for (const candidate of learnable) {
    // Offer it to whoever already owns this concept first (e.g. the web quick-open
    // plugin owns "type this shape → open that page"). A claimed rule lives in
    // that plugin's own list — visible and EDITABLE where the user already
    // manages such rules — instead of a second, delete-only private store.
    const claimedBy = await offerToSink(candidate)
    if (!claimedBy) {
      await putRule(ruleFromCandidate(candidate, now, { silent: true }))
    }
    trackBehavior(TelemetryEvents.learningRuleAutoLearned, {
      transformKind: candidate.transform.kind,
      sampleCount: candidate.sampleCount,
      distinctInputs: candidate.distinctInputs,
      claimedBy: claimedBy ?? undefined,
    })
  }
  await refreshLearnedUrlRules()
  return learnable.length
}

/**
 * Offer a url-template candidate to registered sinks. Only url-templates are
 * offerable today — a chain rule has no owner outside the learner.
 */
async function offerToSink(candidate: RuleCandidate): Promise<string | null> {
  if (candidate.transform.kind !== 'url-template') return null
  // Source-scoped (L1/L2) candidates stay host-owned: the sink protocol only
  // carries template + slotKind, so a claiming plugin would silently drop the
  // sourceHost disambiguation on accept — the exact §3.6 failure mode (learns,
  // never fires right) if it later collides with an unscoped rule of its own.
  if (candidate.matcher.kind === 'token' && candidate.matcher.sourceHost) return null
  return await offerLearnedRule({
    kind: 'url-template',
    template: candidate.transform.template,
    slotKind: candidate.transform.slotKind,
    clusterKey: candidate.clusterKey,
    evidence: {
      sampleCount: candidate.sampleCount,
      distinctInputs: candidate.distinctInputs,
    },
  })
}

/** Persist a user-accepted proposal as a learned rule. */
export async function acceptProposal(candidate: RuleCandidate, now: number = Date.now()): Promise<void> {
  await putRule(ruleFromCandidate(candidate, now))
  await refreshLearnedUrlRules()
  trackBehavior(TelemetryEvents.learningRuleAccepted, {
    transformKind: candidate.transform.kind,
    sampleCount: candidate.sampleCount,
  })
}

/** Record a user rejection — the cluster is never proposed again. */
export async function rejectProposal(clusterKey: string): Promise<void> {
  await addSuppression(clusterKey)
  trackBehavior(TelemetryEvents.learningRuleRejected, {})
}

/**
 * Undo a silently-learned rule at fire time ("not this one").
 *
 * Deletes the rule AND suppresses its cluster. Both halves are required: with
 * silent learning, deleting alone would let the next auto-learn pass re-learn
 * the exact rule the user just dismissed — the undo has to be a terminal state,
 * for the same reason "ignored" had to become one.
 */
export async function undoLearnedRule(rule: LearnedRule): Promise<void> {
  if (rule.id != null) await deleteRule(rule.id)
  await addSuppression(rule.clusterKey)
  await refreshLearnedUrlRules()
  trackBehavior(TelemetryEvents.learningRuleUndone, {
    transformKind: rule.transform.kind,
    fireCount: rule.fireCount ?? 0,
  })
}

/** Remove URL-shape rules learned before URL-template auto-learning was retired. */
export async function purgeStaleUrlTemplateLearning(): Promise<void> {
  try {
    await purgeUrlTemplateLearningOnce()
    await refreshLearnedUrlRules()
  } catch {
    // fail-soft: cleanup must never break the app
  }
}

/** Delay before the first auto-learn pass, so startup isn't competing with it. */
const AUTO_LEARN_FIRST_DELAY_MS = 30_000
/** Interval between later passes. Learning is not urgent; being cheap matters more. */
const AUTO_LEARN_INTERVAL_MS = 10 * 60_000
/**
 * Idle-callback budget: run as soon as the main thread has a natural gap, but
 * never wait longer than this even under sustained activity (the launcher
 * being kept open + typed in continuously must not starve learning forever).
 */
const AUTO_LEARN_IDLE_TIMEOUT_MS = 5_000

/**
 * Run silent learning in the background, off the launcher hot path.
 *
 * Deliberately timer-driven rather than triggered on launcher open: opening the
 * launcher is the latency-critical moment (see doc/launcher-perf-telemetry.md),
 * and learning a rule 10 minutes later costs the user nothing.
 *
 * The timer only *schedules* — the actual pass runs via `scheduleIdleWork` so
 * it lands in a gap between keystrokes/renders instead of firing mid-interaction
 * on whatever main-thread tick the interval happens to land on.
 */
export function startAutoLearnLoop(): () => void {
  let stopped = false
  let cancelIdle: (() => void) | null = null
  const run = () => {
    if (stopped) return
    cancelIdle?.()
    cancelIdle = scheduleIdleWork(() => {
      cancelIdle = null
      if (stopped) return
      void measureLatency(
        TelemetryEvents.learningAutoLearnPass,
        () => autoLearnNow(),
        (learnedCount) => ({ learnedCount }),
      ).catch(() => {
        // fail-soft: learning must never break the app
      })
    }, AUTO_LEARN_IDLE_TIMEOUT_MS)
  }
  const first = setTimeout(run, AUTO_LEARN_FIRST_DELAY_MS)
  const timer = setInterval(run, AUTO_LEARN_INTERVAL_MS)
  return () => {
    stopped = true
    clearTimeout(first)
    clearInterval(timer)
    cancelIdle?.()
  }
}

// ─── management page (P2c) ─────────────────────────────────────────────────────

/** Snapshot for the "learned rules" management page. */
export async function getLearningManagementState(): Promise<{
  rules: LearnedRule[]
  suppressions: Suppression[]
}> {
  const [rules, suppressions] = await Promise.all([queryAllRules(), queryAllSuppressions()])
  return { rules, suppressions }
}

/** Delete a learned rule (management page). */
export async function deleteLearnedRule(id: number): Promise<void> {
  await deleteRule(id)
  await refreshLearnedUrlRules()
  trackBehavior(TelemetryEvents.learningRuleDeleted, {})
}

/** Lift a suppression so the cluster can be proposed again (management page). */
export async function restoreSuppressed(clusterKey: string): Promise<void> {
  await removeSuppression(clusterKey)
}

// ─── scenario D: navigation template discovery ─────────────────────────────────

/** Discover frequently-visited URL templates from passively observed navigations. */
export async function discoverTemplates(): Promise<DiscoveredTemplate[]> {
  const navs = await queryNavigations()
  return induceUrlTemplates(navs)
}

// ─── devtools hook (read-only-ish; dev verification) ───────────────────────────

interface LearningDebugApi {
  proposals: () => Promise<RuleCandidate[]>
  rules: () => Promise<LearnedRule[]>
  templates: () => Promise<DiscoveredTemplate[]>
  /** Feature signature of a text — the matcher.sig to use when crafting a chain rule. */
  sig: (text: string) => string
  /** All available pure-transform runner ids (use these exact ids in a chain rule). */
  runners: () => string[]
  /** Dry-run a chain over text (null = a tool is missing / declines / no change). */
  testChain: (toolIds: string[], text: string) => string | null
  /** One-shot: verify a chain over `text` and, if it runs, teach it as a rule. */
  teachChain: (
    text: string,
    toolIds: string[],
  ) => Promise<{ sig: string; taught: boolean; result: string | null; missingRunners: string[] }>
  dump: () => Promise<{
    pairs: number
    sigCounts: Record<string, number>
    proposals: RuleCandidate[]
    rules: LearnedRule[]
    suppressions: string[]
    navigations: number
    templates: DiscoveredTemplate[]
  }>
  accept: (candidate: RuleCandidate) => Promise<void>
  reject: (clusterKey: string) => Promise<void>
}

let debugHookInstalled = false

/** Install `window.__hivenLearning` for verifying the pipeline against real data. */
export function installLearningDebugHook(): void {
  if (debugHookInstalled || typeof window === 'undefined') return
  debugHookInstalled = true
  const api: LearningDebugApi = {
    proposals: getPendingProposals,
    rules: queryAllRules,
    templates: discoverTemplates,
    sig: (text: string) => featureSignature(extractFeatures(text)),
    runners: () => buildPureTransformRunners().map((r) => r.id),
    testChain: (toolIds: string[], text: string) => runLearnedChain(toolIds, text),
    teachChain: async (text: string, toolIds: string[]) => {
      const sig = featureSignature(extractFeatures(text))
      const runnerIds = new Set(buildPureTransformRunners().map((r) => r.id))
      const missingRunners = toolIds.filter((id) => !runnerIds.has(id))
      const result = runLearnedChain(toolIds, text)
      if (result) {
        await acceptProposal({
          clusterKey: `chain:${toolIds.join('>')}`,
          matcher: { kind: 'feature-sig', sig },
          transform: { kind: 'chain', toolIds },
          sampleCount: 3,
          distinctInputs: 3,
          firstTs: 0,
          lastTs: 0,
        })
      }
      return { sig, taught: Boolean(result), result, missingRunners }
    },
    dump: async () => {
      const [pairs, sigCounts, rules, suppressions, navs] = await Promise.all([
        queryAllPairs(),
        countEventSigs(),
        queryAllRules(),
        queryAllSuppressions(),
        queryNavigations(),
      ])
      return {
        pairs: pairs.length,
        sigCounts,
        proposals: await getPendingProposals(),
        rules,
        suppressions: suppressions.map((s) => s.clusterKey),
        navigations: navs.length,
        templates: await discoverTemplates(),
      }
    },
    accept: acceptProposal,
    reject: rejectProposal,
  }
  ;(window as unknown as { __hivenLearning?: LearningDebugApi }).__hivenLearning = api
}
