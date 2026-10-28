import { detectContent } from '../../kits/content/index'
import type { AiPreflightReason, AiPreflightRequest, AiPreflightResult } from './types'

export type AiSendRequest = {
  /** Stable command identity within the plugin. */
  commandId: string
  /** Localized command name. */
  label: string
  text: string
  extras?: readonly string[]
  /** Readiness request when the plugin has not resolved a target itself. */
  preflight?: AiPreflightRequest
  /** A target the plugin already resolved (e.g. its own provider profile). */
  selection?: AiPreflightResult
}

export type AiSendApproval = { selection: AiPreflightResult }

export function containsSecret(texts: readonly string[]): boolean {
  return texts.some(text => text.trim() !== '' && detectContent(text).some(({ kind }) => kind === 'secret' || kind === 'secret-like'))
}

export function aiSendCharCount(request: Pick<AiSendRequest, 'text' | 'extras'>): number {
  return [request.text, ...(request.extras ?? [])].reduce((total, part) => total + part.length, 0)
}

/** Secret-shaped material is never released to a provider. */
export function decideAiSend(request: Pick<AiSendRequest, 'text' | 'extras'>): { allowed: boolean; secret: boolean } {
  const secret = containsSecret([request.text, ...(request.extras ?? [])])
  return { allowed: !secret, secret }
}

export function aiTargetName(selection: AiPreflightResult): string {
  return [selection.providerName || selection.providerId, selection.agentName || selection.agentId].filter(Boolean).join(' · ')
}

/** Groups preflight reasons into the few user-facing unavailable causes. */
export function aiUnavailableReasonKey(reason: AiPreflightReason): string {
  switch (reason) {
    case 'provider_login_required': return 'reason.login'
    case 'desktop_required':
    case 'cli_missing': return 'reason.desktop'
    case 'metadata_unavailable':
    case 'metadata_timeout': return 'reason.unreachable'
    case 'capability_unavailable':
    case 'input_unavailable': return 'reason.unsupported'
    case 'configuration_changed': return 'reason.changed'
    default: return 'reason.noModel'
  }
}
