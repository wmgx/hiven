import type { LauncherItem, LauncherParamOption, SaveableParamValue } from '../launcher/types'

export type SaveableParamsResult =
  | { ok: true; params: Record<string, SaveableParamValue> }
  | {
      ok: false
      blockedKeys: string[]
      reason: 'unsaveable-non-default' | 'invalid-saveable-value'
    }

function optionValue(option: LauncherParamOption): string {
  return typeof option === 'string' ? option : option.value
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return Object.is(left, right)
}

export function extractSaveableParams(
  item: Pick<LauncherItem, 'params' | 'defaultParams'>,
  params: Record<string, unknown>,
): SaveableParamsResult {
  const specs = item.params ?? []
  const knownKeys = new Set(specs.map((param) => param.key))
  const unknownKeys = Object.keys(params).filter((key) => !knownKeys.has(key) && params[key] !== undefined)
  if (unknownKeys.length > 0) {
    return { ok: false, blockedKeys: unknownKeys, reason: 'invalid-saveable-value' }
  }

  const saved: Record<string, SaveableParamValue> = {}
  const unsaveable: string[] = []
  const invalid: string[] = []
  for (const spec of specs) {
    const fallback = item.defaultParams?.[spec.key] ?? spec.default
    const value = Object.prototype.hasOwnProperty.call(params, spec.key) ? params[spec.key] : fallback
    if (spec.saveable !== true) {
      if (!sameValue(value, fallback)) unsaveable.push(spec.key)
      continue
    }
    if (value === undefined) {
      if (spec.required) invalid.push(spec.key)
      continue
    }
    if (spec.type === 'boolean' && typeof value === 'boolean') saved[spec.key] = value
    else if (spec.type === 'number' && typeof value === 'number' && Number.isFinite(value)) saved[spec.key] = value
    else if (
      spec.type === 'text' &&
      typeof value === 'string' &&
      Number.isInteger(spec.saveableMaxLength) &&
      spec.saveableMaxLength! >= 1 &&
      spec.saveableMaxLength! <= 256 &&
      value.length <= spec.saveableMaxLength!
    ) saved[spec.key] = value
    else if (spec.type === 'single-select' && typeof value === 'string' && (spec.options ?? []).map(optionValue).includes(value)) {
      saved[spec.key] = value
    } else if (
      spec.type === 'multi-select' &&
      Array.isArray(value) &&
      value.every((entry): entry is string => typeof entry === 'string') &&
      value.every((entry) => (spec.options ?? []).map(optionValue).includes(entry))
    ) saved[spec.key] = [...value]
    else invalid.push(spec.key)
  }

  if (invalid.length > 0) return { ok: false, blockedKeys: invalid, reason: 'invalid-saveable-value' }
  if (unsaveable.length > 0) return { ok: false, blockedKeys: unsaveable, reason: 'unsaveable-non-default' }
  return { ok: true, params: saved }
}
