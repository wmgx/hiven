/**
 * Learned url-templates → quick-open rules (pure).
 *
 * web-open already owns the concept "type this shape → open that page", so when
 * the self-learning layer discovers one it hands it here (see the learning sink
 * in index.tsx) instead of keeping a private copy. The user then sees it in the
 * same list as the rules they wrote by hand — and can EDIT it, which a learned
 * rule in the learner's own store could never be.
 *
 * The regexes below are the plugin-side half of a cross-layer contract: the host
 * decides a token's slot kind (urlTemplate.classifyTokenSlot), this decides
 * whether a typed query matches. If the two drift apart, rules get learned and
 * then silently never fire — the exact failure mode that made text tokens
 * unusable before. test-web-open-learned-rules.mjs pins them together by running
 * the host's own representative tokens through these patterns.
 */

import { AUTO_CREATED_TAG, type WebQuickOpenEntry } from './settings/model'

/** Shape of what the host offers. Mirrors LearnedRuleOffer without importing it. */
export interface LearnedOffer {
  kind: string
  template: string
  slotKind: string
  clusterKey: string
  evidence?: { sampleCount: number; distinctInputs: number }
}

/**
 * Token patterns per slot kind. Anchored, and never matching a bare word —
 * a `{slug}` rule that matched "hello" would open a page on every search.
 */
const SLOT_PATTERNS: Record<string, string> = {
  hex: '^[0-9a-fA-F]{7,}$',
  uuid: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  // Mixed letters+digits, 6+ chars: dQw4w9WgXcQ, PROJ-1234, orderXYZ12345.
  id: '^(?=[A-Za-z0-9._-]*[A-Za-z])(?=[A-Za-z0-9._-]*\\d)[A-Za-z0-9._-]{6,}$',
  // Text with a separator: claude-code, flux_text, toutiao.mysql.user.
  // The separator requirement is what keeps bare words out.
  slug: '^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)+$',
}

const SLOT_RE = /\{(hex|uuid|id|slug)\}/

/** Short stable suffix from a cluster key, so ids don't collide or churn. */
function stableSuffix(clusterKey: string): string {
  let h = 5381
  for (let i = 0; i < clusterKey.length; i++) h = ((h << 5) + h + clusterKey.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function hostOf(template: string): string {
  const slash = template.indexOf('/')
  const head = slash === -1 ? template : template.slice(0, slash)
  const q = head.indexOf('?')
  return q === -1 ? head : head.slice(0, q)
}

/**
 * Convert a learned url-template into a quick-open entry, or null if it isn't
 * something this plugin can honestly represent.
 */
export function learnedOfferToEntry(offer: LearnedOffer): (WebQuickOpenEntry & { learnedFrom?: string }) | null {
  if (!offer || offer.kind !== 'url-template') return null
  const template = (offer.template ?? '').trim()
  if (!template || !SLOT_RE.test(template)) return null

  const pattern = SLOT_PATTERNS[offer.slotKind]
  if (!pattern) return null

  const host = hostOf(template)
  if (!host) return null

  return {
    id: `learned-${stableSuffix(offer.clusterKey)}`,
    // Host name as the title: accurate, neutral, and needs no translation —
    // a persisted human string would be wrong in the other locale.
    title: host,
    aliases: [],
    placeholder: '',
    urlTemplate: `https://${template.replace(SLOT_RE, '{query}')}`,
    // Ids are path/query segments that are already URL-safe; percent-encoding
    // them would corrupt the very value the rule exists to substitute.
    encodeQuery: false,
    emptyQueryBehavior: 'block',
    matchPattern: pattern,
    recordQueryHistory: false,
    learnedFrom: offer.clusterKey,
    // Visible marker in the rules list: the user should never wonder where a
    // rule they didn't write came from.
    tags: [AUTO_CREATED_TAG],
  }
}

type EntryLike = WebQuickOpenEntry & { learnedFrom?: string }

/**
 * Append a learned entry to the user's rules.
 *
 * Returns the SAME array when nothing should change, so the caller can skip a
 * settings write. Two things are never done: duplicating a cluster already
 * present, and overwriting an entry the user has since edited — a learned rule
 * that can't be corrected is barely better than one that can't be seen.
 */
export function mergeLearnedEntry(
  entries: readonly EntryLike[],
  learned: EntryLike | null,
): EntryLike[] | readonly EntryLike[] {
  if (!learned) return entries
  const exists = entries.some(
    (entry) => entry.id === learned.id || (learned.learnedFrom && entry.learnedFrom === learned.learnedFrom),
  )
  if (exists) return entries
  return [...entries, learned]
}
