/**
 * Self-learning · URL template induction (scenario D, generic — pure).
 *
 * The heart of *self-discovery*: given the URLs a user actually visits, collapse
 * each into a template by replacing id-like path segments with typed slots
 * (`code.byted.org/lark/-/merge_requests/{n}`), then find templates hit with
 * enough DISTINCT slot values to be a real "you keep opening X/{id}" pattern —
 * not one page reloaded. These become reverse direct-answers (type the id → open
 * the page) for paths the user never hand-coded.
 *
 * Pure: no imports, no side effects, no `URL` global (manual parse) so it stays
 * vm-testable standalone like features.ts / pairing.ts. Privacy: callers store
 * the template + a salted hash of the slot value, never the raw URL/value.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §11 (D) / §5.
 */

export type UrlSlotKind = 'hex' | 'uuid' | 'id' | 'slug'

export interface UrlTemplateResult {
  host: string
  /** host + path with id-like segments replaced by `{kind}` (query/fragment dropped). */
  template: string
  /** Concrete slot values in order (for the caller's salted hash — never stored raw). */
  slots: string[]
  slotKinds: UrlSlotKind[]
}

const URL_RE = /^https?:\/\/([^/?#]+)([^#]*)/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const IDENT_RE = /^[A-Za-z0-9._-]+$/
const SEPARATOR_RE = /[-_.]/

/**
 * CONSERVATIVE classifier — used by the self-discovery path (`templatizeUrl`),
 * where the only evidence is "the user browsed here".
 *
 * Browsing alone cannot distinguish a constant path word from a variable one:
 * in `/-/merge_requests/12345`, both `merge_requests` and `12345` are just
 * segments. So this only claims shapes that are self-evidently identifiers.
 * Text-shaped variables (`/{owner}/{repo}`) are NOT found here — they need
 * cross-sample evidence (see position-variance induction) or a copy event
 * (see {@link classifyTokenSlot}).
 */
export function classifyPathSegment(seg: string): UrlSlotKind | null {
  if (!seg) return null
  // Pure digits are deliberately never a slot: unlike hex/uuid/id/slug they
  // carry no self-evidence of identity — a page number, a quantity, and an MR
  // number are indistinguishable strings. That ambiguity made this the
  // noisiest matcher in practice, so digit-only segments stay literal.
  if (/^\d+$/.test(seg)) return null
  if (UUID_RE.test(seg)) return 'uuid'
  if (/^[0-9a-f]{7,}$/i.test(seg)) return 'hex'
  // Long mixed alphanumeric (has both a letter and a digit) → opaque id.
  if (seg.length >= 12 && /[a-z]/i.test(seg) && /\d/.test(seg) && IDENT_RE.test(seg)) {
    return 'id'
  }
  return null
}

/**
 * WIDE classifier — the single source of truth for both the copy-driven learn
 * path (`templatizeUrlWithToken`) and reverse fire (`queryMatchesSlot`).
 *
 * These two MUST share one function. They used to differ: learning fell back to
 * `'id'` for any unrecognized token while firing re-derived the kind with the
 * conservative classifier, so text tokens (`claude-code`, `PROJ-1234`) were
 * learned, stored, and shown as "learned" — then silently never fired.
 *
 * Wider than {@link classifyPathSegment} because a copy event is real evidence
 * that the token is an entity identifier, not a path constant. It is a strict
 * superset: whenever the conservative classifier claims a kind, this returns
 * the SAME kind, so rules stay interchangeable between the two paths.
 *
 * Guardrail: a bare word (`hello`, `dashboard` — no separator, no digit) is
 * never a slot. Otherwise every learned `{slug}` template would fire on any
 * ordinary search query.
 */
export function classifyTokenSlot(token: string): UrlSlotKind | null {
  const t = (token ?? '').trim()
  if (!t || /\s/.test(t)) return null

  // Superset guarantee: defer to the conservative classifier where it commits.
  const conservative = classifyPathSegment(t)
  if (conservative) return conservative

  if (t.length < 3 || !IDENT_RE.test(t)) return null
  const hasDigit = /\d/.test(t)
  const hasLetter = /[A-Za-z]/.test(t)
  const hasSeparator = SEPARATOR_RE.test(t)

  // Mixed letters+digits → opaque id (`dQw4w9WgXcQ`, `PROJ-1234`). More
  // specific than a slug, so it wins.
  if (hasDigit && hasLetter && t.length >= 6) return 'id'
  // Structured text with separators → slug (`claude-code`, `toutiao.mysql.user`).
  if (hasSeparator && hasLetter) return 'slug'
  // Bare word → not a slot (guardrail above).
  return null
}

/**
 * Extract just the lowercase host from a URL, or null for non-http(s)/malformed
 * input. Used for fire-time disambiguation (which learned rule matches "where
 * you are right now") — a plain string, no site semantics attached.
 */
export function hostnameOf(url: string): string | null {
  const match = URL_RE.exec((url ?? '').trim())
  if (!match) return null
  const host = (match[1] ?? '').toLowerCase()
  return host || null
}

/**
 * Templatize one URL. Returns null for non-http(s) or malformed input.
 * A path id wins (query dropped for clustering stability); if the path carries no
 * id, an id-like query value is templatized instead (`?logid={hex}`), keeping
 * only that param so query-carried ids are discoverable too. Fragment dropped.
 */
export function templatizeUrl(url: string): UrlTemplateResult | null {
  const match = URL_RE.exec((url ?? '').trim())
  if (!match) return null
  const host = (match[1] ?? '').toLowerCase()
  if (!host) return null
  const pathQuery = match[2] ?? ''
  const qIdx = pathQuery.indexOf('?')
  const path = qIdx === -1 ? pathQuery : pathQuery.slice(0, qIdx)
  const query = qIdx === -1 ? '' : pathQuery.slice(qIdx + 1)

  const slots: string[] = []
  const slotKinds: UrlSlotKind[] = []
  const templatedSegments = path.split('/').map((seg) => {
    const kind = classifyPathSegment(seg)
    if (kind) {
      slots.push(seg)
      slotKinds.push(kind)
      return `{${kind}}`
    }
    return seg
  })
  const templatePath = templatedSegments.join('/')

  // Path id is primary — keep single-slot templates by dropping the query.
  if (slots.length > 0) {
    return { host, template: host + templatePath, slots, slotKinds }
  }

  // No path id → the first id-like query value becomes the slot.
  if (query) {
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const value = pair.slice(eq + 1)
      const kind = classifyPathSegment(value)
      if (kind) {
        const key = pair.slice(0, eq)
        return { host, template: `${host}${templatePath}?${key}={${kind}}`, slots: [value], slotKinds: [kind] }
      }
    }
  }

  return { host, template: host + templatePath, slots, slotKinds }
}

export interface NavigationRecord {
  template: string
  /** Salted hash of the concrete slot value(s) — distinct-value counting, never raw. */
  slotHash: string
  slotKind?: UrlSlotKind
  ts: number
  /**
   * Host that was active when the copied token was captured (scenario L1/L2),
   * present only when that differs from the destination host — a same-site
   * copy→navigate carries no disambiguating signal, so it is left unset and
   * flows through the plain (host-agnostic) induction below instead.
   */
  sourceHost?: string
}

export interface DiscoveredTemplate {
  template: string
  host: string
  slotKind: UrlSlotKind
  /** Distinct slot values seen — the evidence a slot really varies. */
  distinctValues: number
  /** Total visits to this template. */
  visits: number
  firstTs: number
  lastTs: number
}

export interface InduceTemplateOptions {
  /** Distinct slot values required to call it a real template. Default 3. */
  minDistinctValues?: number
}

const DEFAULT_MIN_DISTINCT_VALUES = 3

function hostOf(template: string): string {
  const slash = template.indexOf('/')
  return slash === -1 ? template : template.slice(0, slash)
}

/**
 * Discover templates hit with enough distinct slot values. Deterministic order:
 * most distinct values first, then most visits, then most recent.
 */
export function induceUrlTemplates(
  navs: readonly NavigationRecord[],
  opts: InduceTemplateOptions = {},
): DiscoveredTemplate[] {
  const minDistinct = opts.minDistinctValues ?? DEFAULT_MIN_DISTINCT_VALUES

  const groups = new Map<
    string,
    { hashes: Set<string>; visits: number; firstTs: number; lastTs: number; slotKind: UrlSlotKind }
  >()
  for (const nav of navs) {
    // Cross-context evidence belongs to induceSourceScopedTemplates (L1/L2),
    // not here — keeps a record from being learned (and firing) twice.
    if (nav.sourceHost) continue
    // Only templates that actually carry a variable slot are direct-answer candidates.
    if (!nav.template.includes('{')) continue
    const slotKind = nav.slotKind ?? inferSlotKindFromTemplate(nav.template)
    if (!slotKind) continue
    const g = groups.get(nav.template)
    if (g) {
      g.hashes.add(nav.slotHash)
      g.visits += 1
      if (nav.ts < g.firstTs) g.firstTs = nav.ts
      if (nav.ts > g.lastTs) g.lastTs = nav.ts
    } else {
      groups.set(nav.template, {
        hashes: new Set([nav.slotHash]),
        visits: 1,
        firstTs: nav.ts,
        lastTs: nav.ts,
        slotKind,
      })
    }
  }

  const discovered: DiscoveredTemplate[] = []
  for (const [template, g] of groups) {
    if (g.hashes.size < minDistinct) continue
    discovered.push({
      template,
      host: hostOf(template),
      slotKind: g.slotKind,
      distinctValues: g.hashes.size,
      visits: g.visits,
      firstTs: g.firstTs,
      lastTs: g.lastTs,
    })
  }

  discovered.sort((a, b) => {
    if (b.distinctValues !== a.distinctValues) return b.distinctValues - a.distinctValues
    if (b.visits !== a.visits) return b.visits - a.visits
    return b.lastTs - a.lastTs
  })
  return discovered
}

export interface DiscoveredSourceScopedTemplate {
  /** Host that was active when the token was copied — the disambiguating key. */
  sourceHost: string
  template: string
  host: string
  slotKind: UrlSlotKind
  distinctValues: number
  visits: number
  firstTs: number
  lastTs: number
}

/**
 * Discover source-scoped templates (scenario L1/L2): the same token SHAPE
 * copied on different sites can mean different destinations (a hex string on
 * grafana vs. on a code host) — this groups by (sourceHost, template) instead
 * of template alone, so each copy-time site earns its own candidate. Mirrors
 * {@link induceUrlTemplates} otherwise (same threshold, same ranking).
 *
 * Only records carrying a `sourceHost` are considered — the disambiguating
 * evidence navigationSensor attaches when the copy site differs from the
 * destination (see {@link NavigationRecord.sourceHost}).
 */
export function induceSourceScopedTemplates(
  navs: readonly NavigationRecord[],
  opts: InduceTemplateOptions = {},
): DiscoveredSourceScopedTemplate[] {
  const minDistinct = opts.minDistinctValues ?? DEFAULT_MIN_DISTINCT_VALUES

  const groups = new Map<
    string,
    {
      sourceHost: string
      template: string
      hashes: Set<string>
      visits: number
      firstTs: number
      lastTs: number
      slotKind: UrlSlotKind
    }
  >()
  for (const nav of navs) {
    if (!nav.sourceHost) continue
    if (!nav.template.includes('{')) continue
    const slotKind = nav.slotKind ?? inferSlotKindFromTemplate(nav.template)
    if (!slotKind) continue
    const key = `${nav.sourceHost} ${nav.template}`
    const g = groups.get(key)
    if (g) {
      g.hashes.add(nav.slotHash)
      g.visits += 1
      if (nav.ts < g.firstTs) g.firstTs = nav.ts
      if (nav.ts > g.lastTs) g.lastTs = nav.ts
    } else {
      groups.set(key, {
        sourceHost: nav.sourceHost,
        template: nav.template,
        hashes: new Set([nav.slotHash]),
        visits: 1,
        firstTs: nav.ts,
        lastTs: nav.ts,
        slotKind,
      })
    }
  }

  const discovered: DiscoveredSourceScopedTemplate[] = []
  for (const g of groups.values()) {
    if (g.hashes.size < minDistinct) continue
    discovered.push({
      sourceHost: g.sourceHost,
      template: g.template,
      host: hostOf(g.template),
      slotKind: g.slotKind,
      distinctValues: g.hashes.size,
      visits: g.visits,
      firstTs: g.firstTs,
      lastTs: g.lastTs,
    })
  }

  discovered.sort((a, b) => {
    if (b.distinctValues !== a.distinctValues) return b.distinctValues - a.distinctValues
    if (b.visits !== a.visits) return b.visits - a.visits
    return b.lastTs - a.lastTs
  })
  return discovered
}

/** Last `{kind}` slot in a template (fallback when a record didn't store slotKind). */
function inferSlotKindFromTemplate(template: string): UrlSlotKind | null {
  const matches = template.match(/\{(hex|uuid|id|slug)\}/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  return last.slice(1, -1) as UrlSlotKind
}

// ─── content → navigation pairing (scenario A) ─────────────────────────────────

const TOKEN_DELIM = /[/?=&#.]/
function isTokenBoundary(ch: string | undefined): boolean {
  return ch === undefined || TOKEN_DELIM.test(ch)
}

/** Find a delimiter-bounded occurrence of `token` in `hay`, or -1. */
function findBoundedToken(hay: string, token: string): number {
  let from = 0
  for (;;) {
    const i = hay.indexOf(token, from)
    if (i === -1) return -1
    const before = i === 0 ? undefined : hay[i - 1]
    const after = i + token.length >= hay.length ? undefined : hay[i + token.length]
    if (isTokenBoundary(before) && isTokenBoundary(after)) return i
    from = i + 1
  }
}

/**
 * Slot kind for a copied token. Returns null when the token is not
 * identifier-shaped — the caller must then decline to build a rule rather than
 * fall back to a kind the fire side cannot reproduce.
 */
function slotKindForToken(token: string): UrlSlotKind | null {
  return classifyTokenSlot(token)
}

/**
 * Templatize a URL around a specific copied token (scenario A): if the token
 * appears delimiter-bounded in the path or as a query value, replace that
 * occurrence with a typed slot. Catches slots the pure heuristic misses —
 * notably ids carried in the query (`?logid={id}`) which templatizeUrl drops.
 */
export function templatizeUrlWithToken(url: string, token: string): UrlTemplateResult | null {
  const tok = (token ?? '').trim()
  if (tok.length < 4 || /\s/.test(tok)) return null
  const match = /^https?:\/\/([^/?#]+)([^#]*)/i.exec((url ?? '').trim())
  if (!match) return null
  const host = (match[1] ?? '').toLowerCase()
  if (!host) return null
  const pathQuery = match[2] ?? ''
  const qIdx = pathQuery.indexOf('?')
  const path = qIdx === -1 ? pathQuery : pathQuery.slice(0, qIdx)
  const query = qIdx === -1 ? '' : pathQuery.slice(qIdx + 1)
  // No fireable kind → no rule. Learning something that can never match back is
  // worse than learning nothing: it shows up as "learned" and silently does nothing.
  const kind = slotKindForToken(tok)
  if (!kind) return null

  const pathIdx = findBoundedToken(path, tok)
  if (pathIdx !== -1) {
    const templatedPath = path.slice(0, pathIdx) + `{${kind}}` + path.slice(pathIdx + tok.length)
    return { host, template: host + templatedPath, slots: [tok], slotKinds: [kind] }
  }

  if (query) {
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      if (pair.slice(eq + 1) === tok) {
        const key = pair.slice(0, eq)
        return { host, template: `${host}${path}?${key}={${kind}}`, slots: [tok], slotKinds: [kind] }
      }
    }
  }
  return null
}

// ─── reverse fire (scenario D — typed token → open template) ───────────────────

/**
 * True if a typed query is a value of the given slot kind (reverse-fire match).
 * Uses the same wide classifier as the learn path — see {@link classifyTokenSlot}
 * for why that symmetry is load-bearing.
 */
export function queryMatchesSlot(query: string, slotKind: UrlSlotKind): boolean {
  const q = (query ?? '').trim()
  if (!q) return false
  return classifyTokenSlot(q) === slotKind
}

/** Substitute the first `{slot}` placeholder in a template with a concrete value. */
export function fillTemplate(template: string, value: string): string {
  return template.replace(/\{[^}]+\}/, value)
}
