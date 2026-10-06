import { evaluateRegex } from '../src/plugins/regex-tester/regexCore.ts'

function assertIndexes(pattern: string, flags: string, source: string, expected: number[]) {
  const result = evaluateRegex(pattern, flags, source)
  const actual = result.matches.map((match) => match.index)
  if (result.error || actual.join(',') !== expected.join(',')) {
    throw new Error(`${pattern}/${flags}: expected ${expected}, received ${actual}; ${result.error ?? ''}`)
  }
}

assertIndexes('(?=a)', 'g', 'aa', [0, 1])
assertIndexes('(?=.)', 'gu', '😀x', [0, 2])

console.log('regex evaluator checks passed')
