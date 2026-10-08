import type { TranslateProfile } from './model'

/** Saved execution settings only. Draft terms never belong in a request identity. */
export function profileExecutionKey(profile: TranslateProfile | undefined): string {
  if (!profile) return ''
  const values: unknown[] = [
    profile.id, profile.provider, profile.enabled, profile.appId, profile.secret,
    profile.authKey, profile.secretId, profile.secretKey, profile.region, profile.endpoint,
    profile.monthlyLimitChars, profile.aiProviderId, profile.aiAgentId, profile.aiEffort,
  ]
  // Non-AI translation neither reads terms nor changes identity because of them.
  if (profile.provider === 'ai') values.push(profile.aiGlossary)
  return JSON.stringify(values)
}
