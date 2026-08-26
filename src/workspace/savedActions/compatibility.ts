import { extractSaveableParams } from '../experience/saveableParams.ts'
import type { LauncherItem, OutputIntent } from '../launcher/types'
import type { SavedActionDisabledReason, SavedActionV1 } from './types'

export function isGlobalLauncherSavedActionOutput(outputIntent: OutputIntent): boolean {
  return outputIntent === 'copy' ||
    outputIntent === 'return-to-launcher' ||
    outputIntent === 'open-quick-editor'
}

export function savedActionDisabledReason(
  artifact: SavedActionV1,
  baseAction: LauncherItem | null,
  availability: { inputAvailable?: boolean; outputAvailable?: boolean } = {},
): SavedActionDisabledReason | undefined {
  if (!baseAction) return 'missing-action'
  const policy = baseAction.actionPolicy
  if (
    !policy ||
    policy.effect !== artifact.actionPolicy.effect ||
    policy.learnable !== artifact.actionPolicy.learnable
  ) return 'policy-changed'
  if (baseAction.contractFingerprint !== artifact.contractFingerprint) return 'contract-changed'
  for (const key of Object.keys(artifact.savedParams)) {
    if (baseAction.params?.find((param) => param.key === key)?.saveable !== true) return 'saveability-changed'
  }
  if (!extractSaveableParams(baseAction, artifact.savedParams).ok) return 'saveability-changed'
  if (availability.inputAvailable === false) return 'input-unavailable'
  if (availability.outputAvailable === false) return 'output-unavailable'
  return undefined
}
