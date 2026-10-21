/**
 * Line-level diff using LCS (Myers-style).
 * Returns 1-based line numbers that should be highlighted on each side.
 */

type Op = 'equal' | 'delete' | 'insert'

export type TextLineDiffHunk = {
  /** Valid editor lines to reveal on each side, including anchors for one-sided changes. */
  leftLine: number
  rightLine: number
  /** Actually changed lines on each side; one array is empty for pure insert/delete hunks. */
  leftLines: number[]
  rightLines: number[]
}

const MAX_LINES = 2000 // changed region above this falls back to positional comparison

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

/** Trim the common prefix/suffix first so the quadratic table only covers the changed region. */
function diffOps(orig: string[], mod: string[]): Op[] {
  let start = 0
  const minLength = Math.min(orig.length, mod.length)
  while (start < minLength && orig[start] === mod[start]) start++
  let end = 0
  while (end < minLength - start && orig[orig.length - 1 - end] === mod[mod.length - 1 - end]) end++

  const midOrig = orig.slice(start, orig.length - end)
  const midMod = mod.slice(start, mod.length - end)
  const mid = midOrig.length > MAX_LINES || midMod.length > MAX_LINES
    ? positionalOps(midOrig, midMod)
    : lcsOps(midOrig, midMod)
  return [...Array<Op>(start).fill('equal'), ...mid, ...Array<Op>(end).fill('equal')]
}

/** Coarse fallback for huge changed regions: compare line by line at the same index. */
function positionalOps(orig: string[], mod: string[]): Op[] {
  const ops: Op[] = []
  const shared = Math.min(orig.length, mod.length)
  for (let k = 0; k < shared; k++) {
    if (orig[k] === mod[k]) ops.push('equal')
    else ops.push('delete', 'insert')
  }
  for (let k = shared; k < orig.length; k++) ops.push('delete')
  for (let k = shared; k < mod.length; k++) ops.push('insert')
  return ops
}

export function computeTextLineDiff(
  origText: string,
  modText: string,
): { leftHighlights: number[]; rightHighlights: number[]; hunks: TextLineDiffHunk[] } {
  const orig = origText.split('\n')
  const mod  = modText.split('\n')

  const leftHighlights:  number[] = []
  const rightHighlights: number[] = []
  const hunks: TextLineDiffHunk[] = []
  const validLine = (line: number, count: number) => Math.max(1, Math.min(line, count))

  const ops = diffOps(orig, mod)
  let l = 1, r = 1
  let active: TextLineDiffHunk | null = null

  for (const op of ops) {
    if (op === 'equal') {
      active = null
      l++
      r++
      continue
    }
    if (!active) {
      active = {
        leftLine: validLine(l, orig.length),
        rightLine: validLine(r, mod.length),
        leftLines: [],
        rightLines: [],
      }
      hunks.push(active)
    }
    if (op === 'delete') {
      leftHighlights.push(l)
      active.leftLines.push(l)
      l++
    } else {
      rightHighlights.push(r)
      active.rightLines.push(r)
      r++
    }
  }

  return { leftHighlights, rightHighlights, hunks }
}
