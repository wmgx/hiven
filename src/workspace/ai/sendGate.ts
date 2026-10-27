/**
 * AiSendGate (host SDK): plugins say what they send and for which command;
 * the host owns readiness, the send confirmation, per-command "send directly
 * from now on" grants and forced confirmation for secret-shaped content.
 */
import { detectContent } from '../../kits/content/index'
import type { AiPreflightReason, AiPreflightRequest, AiPreflightResult } from './types'

export type AiSendRequest = {
  /** Stable per plugin; grants are recorded per command. */
  commandId: string
  /** Localized command name shown in the confirmation and in settings. */
  label: string
  text: string
  extras?: readonly string[]
  /** Readiness request when the plugin has not resolved a target itself. */
  preflight?: AiPreflightRequest
  /** A target the plugin already resolved (e.g. its own provider profile). */
  selection?: AiPreflightResult
  /**
   * 'implicit': the user's explicit click or bound shortcut already is consent;
   * only secret-shaped content asks. Default 'confirm'.
   */
  consent?: 'confirm' | 'implicit'
}

export type AiSendApproval = {
  selection: AiPreflightResult
  /** Sent without a confirmation because of a recorded grant; show the disclosure line. */
  remembered: boolean
}

export type AiSendGrant = { key: string; label: string }

export const AI_SEND_PREVIEW_CHARS = 200

export function aiSendGrantKey(pluginId: string, commandId: string): string {
  return `${pluginId}:${commandId}`
}

export function containsSecret(texts: readonly string[]): boolean {
  return texts.some(text => text.trim() !== '' && detectContent(text).some(({ kind }) => kind === 'secret' || kind === 'secret-like'))
}

export function aiSendCharCount(request: Pick<AiSendRequest, 'text' | 'extras'>): number {
  return [request.text, ...(request.extras ?? [])].reduce((total, part) => total + part.length, 0)
}

/** Secrets always confirm, ignoring grants and implicit consent. */
export function decideAiSend(request: Pick<AiSendRequest, 'text' | 'extras' | 'consent'>, granted: boolean): { confirm: boolean; secret: boolean } {
  const secret = containsSecret([request.text, ...(request.extras ?? [])])
  if (secret) return { confirm: true, secret }
  return { confirm: request.consent !== 'implicit' && !granted, secret }
}

export function addAiSendGrant(grants: readonly AiSendGrant[], grant: AiSendGrant): AiSendGrant[] {
  return [...grants.filter(item => item.key !== grant.key), grant]
}

export function removeAiSendGrant(grants: readonly AiSendGrant[], key: string): AiSendGrant[] {
  return grants.filter(item => item.key !== key)
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
