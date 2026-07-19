/**
 * Pre-compiled matchPattern cache for Web Quick Open.
 *
 * Patterns are compiled once and reused across keystrokes. When settings
 * entries change, call `replaceMatchPatternCache` so old patterns are dropped
 * and new ones are compiled (replace, not only append).
 */

const compiledPatterns = new Map<string, RegExp | null>()

/**
 * Get a compiled RegExp for `pattern`, compiling and caching on first use.
 * Invalid patterns cache as `null` so we do not rethrow every keystroke.
 */
export function getCompiledMatchPattern(pattern: string): RegExp | null {
  const source = pattern.trim()
  if (!source) return null
  if (compiledPatterns.has(source)) return compiledPatterns.get(source) ?? null
  try {
    const re = new RegExp(source)
    compiledPatterns.set(source, re)
    return re
  } catch {
    compiledPatterns.set(source, null)
    return null
  }
}

/**
 * Test `input` against a (possibly uncompiled) pattern string.
 * Resets `lastIndex` so sticky/global patterns stay safe across calls.
 */
export function testMatchPattern(pattern: string, input: string): boolean {
  const re = getCompiledMatchPattern(pattern)
  if (!re) return false
  re.lastIndex = 0
  try {
    return re.test(input)
  } catch {
    return false
  }
}

/**
 * Replace the entire compiled cache with the given pattern set.
 * - Stale patterns (no longer in settings) are removed.
 * - New patterns are compiled eagerly.
 * Call this whenever settings entries / matchPattern values change or at the
 * start of a dynamicItems pass with the current entry patterns.
 */
export function replaceMatchPatternCache(patterns: Iterable<string>): void {
  const next = new Set<string>()
  for (const raw of patterns) {
    const source = String(raw ?? '').trim()
    if (source) next.add(source)
  }

  for (const key of [...compiledPatterns.keys()]) {
    if (!next.has(key)) compiledPatterns.delete(key)
  }

  for (const source of next) {
    if (!compiledPatterns.has(source)) getCompiledMatchPattern(source)
  }
}

/** Drop one pattern (e.g. after an in-place edit before full replace). */
export function invalidateMatchPattern(pattern: string): void {
  compiledPatterns.delete(pattern.trim())
}

/** Test helper / diagnostics. */
export function getMatchPatternCacheSize(): number {
  return compiledPatterns.size
}

/** Test helper — clear all compiled patterns. */
export function clearMatchPatternCache(): void {
  compiledPatterns.clear()
}
