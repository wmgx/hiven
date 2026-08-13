/**
 * Self-learning · verifiable pairing (P1, generic — no product semantics).
 *
 * Pure: no imports. The observer injects `PureTransformRunner`s built from the
 * registry (tools declaring no side-effect capability). We confirm a clipboard
 * transition A→B is a real, reproducible transform by RE-RUNNING candidate pure
 * transforms on A and comparing to B — turning "same operation?" from a fuzzy
 * time-window guess into a deterministic "can we reproduce it?" test.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.6 / §12.3.
 */

export interface PureTransformRunner {
  id: string
  /** Cheap pre-filter; skip run() when it returns false. */
  textMatch?: (text: string) => boolean
  /** Pure transform; return null when not applicable / failed. Must be side-effect free. */
  run: (text: string) => string | null
}

export interface TransformPairHit {
  toolId: string
}

export interface TransformChainHit {
  toolIds: string[]
}

/** Compare two transform outputs, tolerant of whitespace and JSON formatting / key order. */
export function normalizeEq(a: string, b: string): boolean {
  if (a === b) return true
  if (collapseWhitespace(a) === collapseWhitespace(b)) return true
  const ja = canonicalJson(a)
  const jb = canonicalJson(b)
  return ja !== null && ja === jb
}

function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function canonicalJson(s: string): string | null {
  const trimmed = s.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null
  try {
    return JSON.stringify(sortValue(JSON.parse(trimmed)))
  } catch {
    return null
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key])
    return out
  }
  return value
}

/** Confirm B = T(A) for some candidate pure transform T. Ignores no-op transforms. */
export function verifyTransformPair(
  a: string,
  b: string,
  runners: readonly PureTransformRunner[],
): TransformPairHit | null {
  if (a === b) return null
  for (const runner of runners) {
    if (runner.textMatch && !runner.textMatch(a)) continue
    let out: string | null = null
    try {
      out = runner.run(a)
    } catch {
      out = null
    }
    if (out != null && out !== a && normalizeEq(out, b)) {
      return { toolId: runner.id }
    }
  }
  return null
}

/**
 * Confirm a clipboard sequence is a fixed multi-step chain (scenario B).
 * `seq` = [C0, C1, C2, …]; every hop must verify. Requires ≥ 2 hops — a single
 * hop is just a pair (use {@link verifyTransformPair}).
 */
export function verifyTransformChain(
  seq: readonly string[],
  runners: readonly PureTransformRunner[],
): TransformChainHit | null {
  if (seq.length < 3) return null
  const toolIds: string[] = []
  for (let i = 0; i + 1 < seq.length; i += 1) {
    const hit = verifyTransformPair(seq[i], seq[i + 1], runners)
    if (!hit) return null
    toolIds.push(hit.toolId)
  }
  return toolIds.length >= 2 ? { toolIds } : null
}

/**
 * Replay a learned tool chain over `text` (scenario B fire): each step's output
 * feeds the next. `lookup` resolves a toolId to its runner. Returns the final
 * text, or null if a tool is missing, a step declines its textMatch, a step
 * returns null, or the chain produced no change (no-op). Pure — the reverse-fire
 * path (registryRunners.runLearnedChain) is a thin wrapper over this.
 */
export function runChainWith(
  lookup: (id: string) => PureTransformRunner | undefined,
  toolIds: readonly string[],
  text: string,
): string | null {
  if (toolIds.length === 0) return null
  let current = text
  for (const id of toolIds) {
    const runner = lookup(id)
    if (!runner) return null
    if (runner.textMatch && !runner.textMatch(current)) return null
    const next = runner.run(current)
    if (next == null) return null
    current = next
  }
  return current === text ? null : current
}
