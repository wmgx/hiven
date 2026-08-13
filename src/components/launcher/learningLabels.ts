/**
 * Shared human-readable labels for learned rules / proposals (P2c + scenario D).
 *
 * Renders a rule's input shape + transform in the current locale — used by both
 * the launcher proposal card and the settings management page. Copy is i18n; tool
 * names resolve from the registry per-locale (never persisted). Lives in the
 * components layer so it can pull both i18n and workspace helpers.
 */

import { t, type Locale } from '../../i18n'
import type { RuleMatcher, RuleTransform } from '../../workspace/learning/store'
import { resolveLauncherToolTitle } from '../../workspace/learning/registryRunners'

const CHARSET_KEY: Record<string, string> = {
  hex: 'palette.learnShapeHex',
  digits: 'palette.learnShapeDigits',
  base64: 'palette.learnShapeBase64',
  alpha: 'palette.learnShapeAlpha',
  alnum: 'palette.learnShapeAlnum',
  mixed: 'palette.learnShapeMixed',
}

const SLOT_KEY: Record<string, string> = {
  n: 'palette.learnSlotNumber',
  hex: 'palette.learnSlotHex',
  uuid: 'palette.learnSlotUuid',
  id: 'palette.learnSlotId',
}

/** "hex string · multi-line" / "a number" — describes the input a rule matches. */
export function matcherShapeLabel(matcher: RuleMatcher, locale: Locale): string {
  if (matcher.kind === 'token') {
    return t(locale, SLOT_KEY[matcher.tokenKind] ?? 'palette.learnShapeMixed')
  }
  let charset = 'mixed'
  const flags: string[] = []
  for (const part of matcher.sig.split('|')) {
    if (part.startsWith('cs:')) charset = part.slice('cs:'.length)
    else if (part.startsWith('len:')) continue
    else if (part) flags.push(part)
  }
  const parts = [t(locale, CHARSET_KEY[charset] ?? 'palette.learnShapeMixed')]
  if (flags.includes('url')) parts.push(t(locale, 'palette.learnShapeUrl'))
  if (flags.includes('email')) parts.push(t(locale, 'palette.learnShapeEmail'))
  if (flags.includes('ml')) parts.push(t(locale, 'palette.learnShapeMultiline'))
  return parts.join(' · ')
}

/** "URL decode → JSON prettify" / a URL template — what a rule does when it fires. */
export function transformLabel(transform: RuleTransform, locale: Locale): string {
  if (transform.kind === 'tool') {
    return resolveLauncherToolTitle(transform.toolId, locale)
  }
  if (transform.kind === 'chain') {
    return transform.toolIds.map((id) => resolveLauncherToolTitle(id, locale)).join(' → ')
  }
  return transform.template
}

/** i18n body key for a rule's transform kind. */
export function transformBodyKey(transform: RuleTransform): string {
  if (transform.kind === 'chain') return 'palette.learnProposalBodyChain'
  if (transform.kind === 'url-template') return 'palette.learnProposalBodyUrl'
  return 'palette.learnProposalBody'
}
