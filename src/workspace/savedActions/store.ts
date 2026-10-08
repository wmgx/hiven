import type { LastSaveableRun, SavedActionDisabledReason, SavedActionV1 } from './types'

const STORAGE_KEY = 'hiven:saved-actions:v1'
const listeners = new Set<() => void>()

/** Reuse the existing persisted artifacts; this only invalidates live candidates. */
export function subscribeSavedActions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isSavedAction(value: unknown): value is SavedActionV1 {
  if (!value || typeof value !== 'object') return false
  const action = value as Partial<SavedActionV1>
  const keys = Object.keys(value)
  const allowedKeys = new Set([
    'schemaVersion', 'id', 'name', 'aliases', 'baseActionKey', 'savedParams',
    'inputBinding', 'outputIntent', 'contractFingerprint', 'actionPolicy',
    'createdAt', 'lastInvokedAt', 'disabledReason',
  ])
  if (keys.some((key) => !allowedKeys.has(key))) return false
  const params = action.savedParams && typeof action.savedParams === 'object' && !Array.isArray(action.savedParams)
    ? Object.values(action.savedParams)
    : null
  const paramsValid = params?.every((entry) =>
    typeof entry === 'boolean' ||
    (typeof entry === 'number' && Number.isFinite(entry)) ||
    (typeof entry === 'string' && entry.length <= 256) ||
    (Array.isArray(entry) && entry.every((value) => typeof value === 'string' && value.length <= 256))
  ) === true
  const policyValid = Boolean(
    action.actionPolicy &&
    Object.keys(action.actionPolicy).every((key) => key === 'effect' || key === 'learnable') &&
    typeof action.actionPolicy.effect === 'string' &&
    typeof action.actionPolicy.learnable === 'boolean',
  )
  const disabledReasonValid = action.disabledReason === undefined || [
    'missing-action', 'ambiguous-action', 'contract-changed', 'policy-changed', 'saveability-changed',
    'input-unavailable', 'output-unavailable',
  ].includes(action.disabledReason)
  return action.schemaVersion === 1 &&
    typeof action.id === 'string' &&
    typeof action.name === 'string' &&
    Array.isArray(action.aliases) && action.aliases.every((alias) => typeof alias === 'string') &&
    typeof action.baseActionKey === 'string' &&
    paramsValid &&
    ['selection', 'active-text', 'prompt'].includes(action.inputBinding ?? '') &&
    typeof action.outputIntent === 'string' &&
    typeof action.contractFingerprint === 'string' &&
    policyValid &&
    typeof action.createdAt === 'number' &&
    disabledReasonValid
}

export function listSavedActions(): SavedActionV1[] {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter(isSavedAction) : []
  } catch {
    return []
  }
}

function write(actions: SavedActionV1[], notify = true): void {
  const target = storage()
  if (!target) throw new Error('Saved Action storage is unavailable')
  const serialized = JSON.stringify(actions)
  target.setItem(STORAGE_KEY, serialized)
  if (target.getItem(STORAGE_KEY) !== serialized) throw new Error('Saved Action persistence failed')
  if (notify) {
    for (const listener of listeners) {
      try { listener() } catch (error) { console.warn('[hiven] Saved Action refresh failed:', error) }
    }
  }
}

function cleanText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength)
}

export function createSavedAction(
  run: LastSaveableRun,
  name: string,
  aliases: string[],
): SavedActionV1 {
  const cleanName = cleanText(name, 80)
  if (!cleanName) throw new Error('Saved Action name is required')
  const action: SavedActionV1 = {
    schemaVersion: 1,
    id: `artifact_${globalThis.crypto.randomUUID()}`,
    name: cleanName,
    aliases: [...new Set(aliases.map((alias) => cleanText(alias, 80)).filter(Boolean))].slice(0, 10),
    baseActionKey: run.actionKey,
    savedParams: { ...run.savedParams },
    inputBinding: run.inputBinding,
    outputIntent: run.outputIntent,
    contractFingerprint: run.contractFingerprint,
    actionPolicy: { ...run.actionPolicy },
    createdAt: Date.now(),
  }
  write([...listSavedActions(), action])
  return action
}

export function deleteSavedAction(id: string): SavedActionV1 | undefined {
  const actions = listSavedActions()
  const removed = actions.find((action) => action.id === id)
  if (removed) write(actions.filter((action) => action.id !== id))
  return removed
}

/** Immutable row identity/configuration; invocation and derived availability are not edits. */
export function savedActionSnapshot(action: SavedActionV1): string {
  return JSON.stringify({
    schemaVersion: action.schemaVersion,
    id: action.id,
    createdAt: action.createdAt,
    name: action.name,
    aliases: action.aliases,
    baseActionKey: action.baseActionKey,
    savedParams: Object.fromEntries(Object.keys(action.savedParams).sort().map((key) => [key, action.savedParams[key]])),
    inputBinding: action.inputBinding,
    outputIntent: action.outputIntent,
    contractFingerprint: action.contractFingerprint,
    actionPolicy: { effect: action.actionPolicy.effect, learnable: action.actionPolicy.learnable },
  })
}

function readSavedActionsForEdit(validateAll = false): SavedActionV1[] {
  const target = storage()
  if (!target) throw new Error('Saved Action storage is unavailable')
  const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? '[]') as unknown
  if (!Array.isArray(parsed)) throw new Error('Saved Action storage is invalid')
  // Explicit deletion must not drop an unrelated entry that discovery cannot read.
  if (validateAll && !parsed.every(isSavedAction)) throw new Error('Saved Action storage is invalid')
  return parsed.filter(isSavedAction)
}

/** Unlike list discovery, an explicit edit must distinguish read failure from deletion. */
export function getSavedActionForRename(id: string): SavedActionV1 | undefined {
  return readSavedActionsForEdit().find((action) => action.id === id)
}

type SavedActionDeleteTarget = { status: 'ready'; action: SavedActionV1 } | { status: 'missing' | 'changed' }

function savedActionDeleteTarget(actions: SavedActionV1[], id: string, expectedSnapshot: string): SavedActionDeleteTarget {
  const matches = actions.filter((action) => action.id === id)
  if (matches.length === 0) return { status: 'missing' }
  if (matches.length !== 1 || savedActionSnapshot(matches[0]) !== expectedSnapshot) return { status: 'changed' }
  return { status: 'ready', action: matches[0] }
}

/** Check the exact displayed row before presenting its confirmation. */
export function getSavedActionForDelete(id: string, expectedSnapshot: string): SavedActionDeleteTarget {
  return savedActionDeleteTarget(readSavedActionsForEdit(true), id, expectedSnapshot)
}

/** Recheck the approved configuration immediately before the synchronous write. */
export function deleteSavedActionIfUnchanged(
  id: string,
  expectedSnapshot: string,
): { status: 'deleted'; action: SavedActionV1 } | { status: 'missing' | 'changed' } {
  const actions = readSavedActionsForEdit(true)
  const target = savedActionDeleteTarget(actions, id, expectedSnapshot)
  if (target.status !== 'ready') return target
  write(actions.filter((action) => action !== target.action))
  return { status: 'deleted', action: target.action }
}

/** Rename the chosen artifact without replacing its identity or execution settings. */
export function renameSavedAction(
  id: string,
  name: string,
  expectedName: string,
): { status: 'renamed'; action: SavedActionV1 } | { status: 'missing' | 'changed' | 'invalid-name' } {
  const cleanName = name.trim()
  if (!cleanName || cleanName.length > 80) return { status: 'invalid-name' }
  const actions = readSavedActionsForEdit()
  const index = actions.findIndex((action) => action.id === id)
  if (index < 0) return { status: 'missing' }
  const current = actions[index]
  if (current.name !== expectedName) return { status: 'changed' }
  if (current.name === cleanName) return { status: 'renamed', action: current }
  const renamed = { ...current, name: cleanName }
  actions[index] = renamed
  write(actions)
  return { status: 'renamed', action: renamed }
}

export function touchSavedAction(id: string): void {
  const actions = listSavedActions()
  const index = actions.findIndex((action) => action.id === id)
  if (index < 0) return
  actions[index] = { ...actions[index], lastInvokedAt: Date.now() }
  write(actions, false)
}

export function setSavedActionDisabledReason(id: string, disabledReason?: SavedActionDisabledReason): void {
  const actions = listSavedActions()
  const index = actions.findIndex((action) => action.id === id)
  if (index < 0 || actions[index].disabledReason === disabledReason) return
  const { disabledReason: _previous, ...action } = actions[index]
  actions[index] = disabledReason ? { ...action, disabledReason } : action
  write(actions, false)
}
