import BigNumber from 'bignumber.js'
import type { Table } from './csvCore'

// Local configuration must never affect the calculator or another plugin.
const Decimal = BigNumber.clone({ DECIMAL_PLACES: 1100, ROUNDING_MODE: BigNumber.ROUND_HALF_UP, RANGE: [-2000, 2000] })
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
export type ColumnStatistics = {
  column: string
  index: number
  rows: number
  valid: number
  empty: number
  invalid: number
  outOfRange: number
  distinct: number
  sum: string | null
  average: string | null
  averageRounded: boolean
}
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** Full-result statistics; exact-string distinct count excludes whitespace-only cells. */
export async function columnStatistics(table: Table, columnIndexes: ReadonlySet<number>, signal?: AbortSignal): Promise<ColumnStatistics[]> {
  aborted(signal)
  const results: ColumnStatistics[] = []
  let visited = 0
  for (let index = 0; index < table.headers.length; index++) {
    const column = table.headers[index]
    if (!columnIndexes.has(index)) continue
    const stats: ColumnStatistics = { column, index, rows: table.rows.length, valid: 0, empty: 0, invalid: 0, outOfRange: 0, distinct: 0, sum: null, average: null, averageRounded: false }
    let sum = new Decimal(0)
    const distinct = new Set<string>()
    for (const row of table.rows) {
      const raw = row[index] ?? ''
      const text = raw.trim()
      if (!text) stats.empty++
      else {
        distinct.add(raw)
        if (!DECIMAL.test(text)) stats.invalid++
        else if (text.length > 512 || Math.abs(Number(text.split(/[eE]/)[1] || 0)) > 1000) stats.outOfRange++
        else {
          const value = new Decimal(text)
          if (!value.isFinite() || (value.e !== null && Math.abs(value.e) > 1000) || (value.precision() ?? 0) > 100 || (value.isZero() && /[1-9]/.test(text.split(/[eE]/)[0]))) stats.outOfRange++
          else { stats.valid++; sum = sum.plus(value) }
        }
      }
      visited++
      if (visited % 2000 === 0) {
        aborted(signal)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        aborted(signal)
      }
    }
    stats.distinct = distinct.size
    if (stats.valid) {
      stats.sum = sum.toString()
      const average = sum.dividedBy(stats.valid).precision(20, Decimal.ROUND_HALF_UP)
      stats.average = average.toString()
      stats.averageRounded = !average.multipliedBy(stats.valid).eq(sum)
    }
    results.push(stats)
  }
  aborted(signal)
  return results
}
