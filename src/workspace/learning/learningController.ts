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

import { TelemetryEvents, trackBehavior, trackPerf } from '../telemetry'
import { selectProposableCandidates, type RuleCandidate } from './cluster'
import { isShapeCovered, representativeTokens, type CoverageProbe } from './coverage'
import { extractFeatures, featureSignature } from './features'
import { refreshLearnedUrlRules } from './fire'
import { buildPureTransformRunners, runLearnedChain } from './registryRunners'
import { filterProposableCandidates, ruleFromCandidate, templateToCandidate } from './proposals'
import {
  addSuppression,
  countEventSigs,
  deleteRule,
  putRule,
  queryAllPairs,
  queryAllRules,
  queryAllSuppressions,
  queryNavigations,
  removeSuppression,
  type LearnedRule,
  type Suppression,
} from './store'
import { induceUrlTemplates, type DiscoveredTemplate } from './urlTemplate'

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

/** Compute the proposals worth surfacing right now (strongest first, capped). */
export async function getPendingProposals(): Promise<RuleCandidate[]> {
  const [pairs, eventSigCounts, rules, suppressions, navs] = await Promise.all([
    queryAllPairs(),
    countEventSigs(),
    queryAllRules(),
    queryAllSuppressions(),
    queryNavigations(),
  ])
  // Merge both discovery sources: verified transform clusters + navigation
  // templates (self-discovery), strongest evidence first.
  const merged = [
    ...selectProposableCandidates(pairs, eventSigCounts),
    ...induceUrlTemplates(navs).map(templateToCandidate),
  ]
    .filter(isCandidateNovel)
    .sort((a, b) => {
      if (b.distinctInputs !== a.distinctInputs) return b.distinctInputs - a.distinctInputs
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount
      return b.lastTs - a.lastTs
    })
  const filtered = filterProposableCandidates(merged, {
    learnedKeys: rules.map((r) => r.clusterKey),
    suppressedKeys: suppressions.map((s) => s.clusterKey),
  })
  if (filtered.length > 0) {
    const top = filtered[0]
    trackBehavior(TelemetryEvents.learningProposalReady, {
      transformKind: top.transform.kind,
      sampleCount: top.sampleCount,
      distinctInputs: top.distinctInputs,
    })
  }
  return filtered
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
