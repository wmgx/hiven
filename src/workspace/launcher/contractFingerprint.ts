import type { LauncherParamOption, LauncherParamSpec, SystemLauncherItemKey, TextInputPolicy } from './types'

function optionValue(option: LauncherParamOption): string {
  return typeof option === 'string' ? option : option.value
}

export function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function computeContractFingerprint(contract: {
  systemKey: SystemLauncherItemKey
  inputPolicy?: TextInputPolicy
  params?: LauncherParamSpec[]
}): string {
  const canonical = JSON.stringify({
    systemKey: contract.systemKey,
    inputPolicy: contract.inputPolicy ?? null,
    params: (contract.params ?? []).map((param) => ({
      key: param.key,
      type: param.type,
      required: param.required === true,
      default: param.default ?? null,
      options: param.options?.map(optionValue) ?? [],
    })),
  })
  return `v1:${fnv1a64(canonical)}`
}
