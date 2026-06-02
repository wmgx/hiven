/**
 * Line-level diff using LCS (Myers-style).
 * Returns 1-based line numbers that should be highlighted on each side.
 */

type Op = 'equal' | 'delete' | 'insert'

const MAX_LINES = 4000 // skip detailed diff for very large files

function lcsOps(orig: string[], mod: string[]): Op[] {
  const n = orig.length
  const m = mod.length

  if (n === 0 && m === 0) return []
  if (n === 0) return Array(m).fill('insert')
  if (m === 0) return Array(n).fill('delete')

  // DP table
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = orig[i - 1] === mod[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack
  const ops: Op[] = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && orig[i - 1] === mod[j - 1]) {
      ops.push('equal'); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push('insert'); j--
    } else {
      ops.push('delete'); i--
    }
  }
  return ops.reverse()
}

export function computeTextLineDiff(
  origText: string,
  modText: string,
): { leftHighlights: number[]; rightHighlights: number[] } {
  const orig = origText.split('\n')
  const mod  = modText.split('\n')

  const leftHighlights:  number[] = []
  const rightHighlights: number[] = []

  // For huge files, highlight everything that differs at a coarse level
  if (orig.length > MAX_LINES || mod.length > MAX_LINES) {
    const limit = Math.max(orig.length, mod.length)
    for (let k = 1; k <= limit; k++) {
      if (orig[k - 1] !== mod[k - 1]) {
        if (k <= orig.length) leftHighlights.push(k)
        if (k <= mod.length)  rightHighlights.push(k)
      }
    }
    return { leftHighlights, rightHighlights }
  }

  const ops = lcsOps(orig, mod)
  let l = 1, r = 1

  for (const op of ops) {
    if (op === 'equal') { l++; r++ }
    else if (op === 'delete') { leftHighlights.push(l);  l++ }
    else                      { rightHighlights.push(r); r++ }
  }

  return { leftHighlights, rightHighlights }
}
