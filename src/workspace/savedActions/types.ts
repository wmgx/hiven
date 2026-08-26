import type {
  InputBinding,
  OutputIntent,
  SaveableParamValue,
  ToolActionPolicy,
} from '../launcher/types'

export type LastSaveableRun = {
  status: 'ready'
  runId: string
  actionKey: string
  savedParams: Record<string, SaveableParamValue>
  inputBinding: InputBinding
  outputIntent: OutputIntent
  contractFingerprint: string
  actionPolicy: ToolActionPolicy
  completedAt: number
}

export type BlockedSaveableRun = {
  status: 'blocked'
  runId: string
  actionKey: string
  blockedKeys: string[]
  reason: 'unsaveable-non-default' | 'invalid-saveable-value'
  completedAt: number
}

export type LastSaveableRunState = LastSaveableRun | BlockedSaveableRun

export type SavedActionDisabledReason =
  | 'missing-action'
  | 'contract-changed'
  | 'policy-changed'
  | 'saveability-changed'
  | 'input-unavailable'
  | 'output-unavailable'

export type SavedActionV1 = {
  schemaVersion: 1
  id: string
  name: string
  aliases: string[]
  baseActionKey: string
  savedParams: Record<string, SaveableParamValue>
  inputBinding: InputBinding
  outputIntent: OutputIntent
  contractFingerprint: string
  actionPolicy: ToolActionPolicy
  createdAt: number
  lastInvokedAt?: number
  disabledReason?: SavedActionDisabledReason
}
