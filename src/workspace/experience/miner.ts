import { fnv1a64 } from '../launcher/contractFingerprint.ts'
import type { InputBinding, LauncherItem, LauncherSurfaceId, OutputIntent, SaveableParamValue } from '../launcher/types'
import { extractSaveableParams } from './saveableParams.ts'
import { canonicalSafeParams } from './miningFingerprint.ts'
import type { ExperienceEvent } from './types'
import type { SavedActionV1 } from '../savedActions/types'

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000

export type ExperienceEventRecord = ExperienceEvent & { seq?: number }

export type LearningCandidate = {
  candidateKey: string
  actionKey: string
  savedParams: Record<string, SaveableParamValue>
  paramLabels: Record<string, { label: string; labelI18n?: LauncherItem['display']['titleI18n'] }>
  inputBinding: InputBinding
  outputIntent: OutputIntent
  contractFingerprint: string
  actionPolicy: NonNullable<LauncherItem['actionPolicy']>
  actionTitle: string
  actionTitleI18n?: LauncherItem['display']['titleI18n']
  occurrences: number
  distinctInputs: number
  dayCount: number
  lastUsedAt: number
}

function localDay(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function defaultOutputIntent(surfaceId: LauncherSurfaceId | undefined): OutputIntent | undefined {
  if (!surfaceId) return undefined
  return surfaceId === 'global-launcher' ? 'copy' : 'replace-active-text'
}

function parseParams(value: string | undefined): Record<string, SaveableParamValue> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, SaveableParamValue>
  } catch {
    return null
  }
}

function sameSavedAction(
  artifact: SavedActionV1,
  actionKey: string,
  paramsJson: string,
  inputBinding: InputBinding,
  outputIntent: OutputIntent,
): boolean {
  return artifact.baseActionKey === actionKey &&
    canonicalSafeParams(artifact.savedParams) === paramsJson &&
    artifact.inputBinding === inputBinding &&
    artifact.outputIntent === outputIntent
}

export function candidateKeyFor(
  actionKey: string,
  paramSignature: string,
  paramsJson: string,
  inputBinding: InputBinding,
  outputIntent: OutputIntent,
): string {
  return `candidate_${fnv1a64(`${actionKey}\0${paramSignature}\0${paramsJson}\0${inputBinding}\0${outputIntent}`)}`
}

export function mineLearningCandidates(options: {
  events: ExperienceEventRecord[]
  baseItems: LauncherItem[]
  savedActions?: SavedActionV1[]
  suppressedCandidateKeys?: ReadonlySet<string>
  disabledActionKeys?: ReadonlySet<string>
  now?: number
}): LearningCandidate[] {
  const now = options.now ?? Date.now()
  const baseByKey = new Map(options.baseItems.map((item) => [item.systemKey, item]))
  const startedByRun = new Map(options.events
    .filter((event) => event.eventType === 'run.started' && event.runId)
    .map((event) => [event.runId!, event]))
  const finishedByRun = new Map<string, ExperienceEventRecord[]>()
  for (const event of options.events) {
    if (event.eventType !== 'run.finished' || !event.runId) continue
    const list = finishedByRun.get(event.runId) ?? []
    list.push(event)
    finishedByRun.set(event.runId, list)
  }

  type Group = {
    base: LauncherItem
    params: Record<string, SaveableParamValue>
    paramsJson: string
    binding: InputBinding
    output: OutputIntent
    events: ExperienceEventRecord[]
  }
  const groups = new Map<string, Group>()
  for (const applied of options.events) {
    if (
      applied.eventType !== 'output.applied' ||
      applied.outputApplication !== 'explicit' ||
      applied.via === 'saved-action' ||
      !applied.runId ||
      applied.ts < now - LOOKBACK_MS
    ) continue
    const started = startedByRun.get(applied.runId)
    const finished = finishedByRun.get(applied.runId) ?? []
    if (
      !started ||
      started.via === 'saved-action' ||
      !finished.length ||
      finished.some((event) => event.status !== 'success') ||
      !started.actionKey ||
      !started.inputBinding ||
      !started.inputFingerprint ||
      !started.paramSignature ||
      !started.safeParamsJson ||
      !applied.outputIntent
    ) continue
    const base = baseByKey.get(started.actionKey)
    if (!base || base.actionPolicy?.learnable !== true || !['pure', 'read'].includes(base.actionPolicy.effect)) continue
    if (options.disabledActionKeys?.has(started.actionKey)) continue
    const params = parseParams(started.safeParamsJson)
    if (!params || canonicalSafeParams(params) !== started.safeParamsJson) continue
    const extracted = extractSaveableParams(base, params)
    if (!extracted.ok || canonicalSafeParams(extracted.params) !== started.safeParamsJson) continue
    const defaults = extractSaveableParams(base, {})
    if (
      defaults.ok &&
      canonicalSafeParams(defaults.params) === started.safeParamsJson &&
      defaultOutputIntent(applied.surfaceId) === applied.outputIntent
    ) continue
    const key = candidateKeyFor(
      started.actionKey,
      started.paramSignature,
      started.safeParamsJson,
      started.inputBinding,
      applied.outputIntent,
    )
    if (options.suppressedCandidateKeys?.has(key)) continue
    const group = groups.get(key) ?? {
      base,
      params,
      paramsJson: started.safeParamsJson,
      binding: started.inputBinding,
      output: applied.outputIntent,
      events: [],
    }
    group.events.push({ ...applied, inputFingerprint: started.inputFingerprint })
    groups.set(key, group)
  }

  const candidates: LearningCandidate[] = []
  for (const [candidateKey, group] of groups) {
    const fingerprints = new Set(group.events.map((event) => event.inputFingerprint))
    const days = new Set(group.events.map((event) => localDay(event.ts)))
    if (group.events.length < 4 || fingerprints.size < 3 || days.size < 2) continue
    const defaults = extractSaveableParams(group.base, {})
    if (!defaults.ok) continue
    const firstSurface = group.events[0]?.surfaceId
    if (
      canonicalSafeParams(defaults.params) === group.paramsJson &&
      defaultOutputIntent(firstSurface) === group.output
    ) continue
    if ((options.savedActions ?? []).some((artifact) => sameSavedAction(
      artifact,
      group.base.systemKey,
      group.paramsJson,
      group.binding,
      group.output,
    ))) continue
    candidates.push({
      candidateKey,
      actionKey: group.base.systemKey,
      savedParams: group.params,
      paramLabels: Object.fromEntries((group.base.params ?? []).map((param) => [
        param.key,
        { label: param.label, labelI18n: param.labelI18n },
      ])),
      inputBinding: group.binding,
      outputIntent: group.output,
      contractFingerprint: group.base.contractFingerprint ?? '',
      actionPolicy: group.base.actionPolicy!,
      actionTitle: group.base.display.title,
      actionTitleI18n: group.base.display.titleI18n,
      occurrences: group.events.length,
      distinctInputs: fingerprints.size,
      dayCount: days.size,
      lastUsedAt: Math.max(...group.events.map((event) => event.ts)),
    })
  }
  return candidates.sort((left, right) => right.lastUsedAt - left.lastUsedAt)
}

export function summarizeCandidateFeedback(events: ExperienceEventRecord[], candidateKey: string) {
  const matching = events.filter((event) => event.candidateKey === candidateKey)
  const surfaced = matching.filter((event) => event.eventType === 'candidate.surfaced').length
  const ignored = matching.filter((event) => event.eventType === 'candidate.dismissed' && event.candidateDecision === 'ignore-once').length
  const suppressed = matching.filter((event) => event.eventType === 'candidate.dismissed' && event.candidateDecision === 'suppress-cluster').length
  const saved = matching.filter((event) => event.eventType === 'artifact.saved').length
  return { surfaced, ignored, suppressed, saved, ignoreRate: surfaced ? ignored / surfaced : 0 }
}
