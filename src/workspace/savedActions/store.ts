import type { LastSaveableRun, SavedActionDisabledReason, SavedActionV1 } from './types'

const STORAGE_KEY = 'hiven:saved-actions:v1'

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
    'missing-action', 'contract-changed', 'policy-changed', 'saveability-changed',
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

function write(actions: SavedActionV1[]): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(actions))
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

export function touchSavedAction(id: string): void {
  const actions = listSavedActions()
  const index = actions.findIndex((action) => action.id === id)
  if (index < 0) return
  actions[index] = { ...actions[index], lastInvokedAt: Date.now() }
  write(actions)
}

export function setSavedActionDisabledReason(id: string, disabledReason?: SavedActionDisabledReason): void {
  const actions = listSavedActions()
  const index = actions.findIndex((action) => action.id === id)
  if (index < 0 || actions[index].disabledReason === disabledReason) return
  const { disabledReason: _previous, ...action } = actions[index]
  actions[index] = disabledReason ? { ...action, disabledReason } : action
  write(actions)
}
