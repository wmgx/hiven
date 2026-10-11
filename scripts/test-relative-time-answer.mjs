import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = ts.transpileModule(readFileSync('src/plugins/date-time-assistant/relativeTimeAnswer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 } }).outputText
const { parseRelativeTimeAnswer: parse } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const value = (query, base, zone = 'UTC') => {
  const result = parse(query, new Date(base), zone)
  assert.equal(result?.ok, true, JSON.stringify(result))
  return result.value
}
assert.equal(value('3天前', '2026-10-11T12:34:56.789Z').target, '2026-10-08 12:34:56 UTC+00:00')
assert.equal(value('3 days ago', '2026-10-11T12:34:56.789Z').base, '2026-10-11 12:34:56 UTC+00:00')
assert.equal(value('in 3 hours', '2026-10-11T23:34:56Z').target, '2026-10-12 02:34:56 UTC+00:00')
assert.equal(value('15分钟前', '2026-10-11T00:05:00Z').target, '2026-10-10 23:50:00 UTC+00:00')
assert.equal(value('1天后', '2028-02-28T12:00:00Z').target, '2028-02-29 12:00:00 UTC+00:00')
assert.equal(value('3天前', '2026-03-02T12:00:00Z').target, '2026-02-27 12:00:00 UTC+00:00')
assert.equal(value('1 day ago', '2026-03-09T05:30:00Z', 'America/New_York').epoch, Date.parse('2026-03-08T06:30:00Z'))
assert.equal(value('24 hours ago', '2026-03-09T05:30:00Z', 'America/New_York').epoch, Date.parse('2026-03-08T05:30:00Z'))
assert.equal(value('in 1 day', '2026-03-07T17:00:00Z', 'America/New_York').epoch, Date.parse('2026-03-08T16:00:00Z'))
assert.equal(value('in 24 hours', '2026-03-07T17:00:00Z', 'America/New_York').epoch, Date.parse('2026-03-08T17:00:00Z'))
assert.deepEqual(parse('in 1 day', new Date('2026-03-07T07:30:00Z'), 'America/New_York'), { ok: false, error: 'gap' })
assert.deepEqual(parse('in 1 day', new Date('2026-10-31T05:30:00Z'), 'America/New_York'), { ok: false, error: 'fold' })
assert.deepEqual(parse('in 1 day', new Date('2011-12-29T22:00:00Z'), 'Pacific/Apia'), { ok: false, error: 'gap' })
assert.equal(value('in 3 hours', '2026-10-11T12:00:00Z', 'Asia/Kathmandu').target, '2026-10-11 20:45:00 UTC+05:45')
for (const text of ['3个月前', '1月后', '1年前', 'in 1 month', '2 years ago']) assert.equal(parse(text)?.error, 'unit')
for (const text of ['3.5天前', '-3天前', '几天前', 'in a few hours', 'about 3 days ago']) assert.equal(parse(text)?.error, 'syntax')
for (const text of ['3661天后', 'in 87841 hours', '999999999999999999 days ago']) assert.equal(parse(text)?.error, 'range')
assert.equal(value('0 days ago', '2026-10-11T12:00:00Z').epoch, Date.parse('2026-10-11T12:00:00Z'))
assert.equal(parse('3 days ago', new Date(), 'Bad/Zone')?.error, 'zone')
for (const text of ['now', '3pm EST', '*/5 * * * *', 'AI settings']) assert.equal(parse(text), null)
console.log('Relative time: bilingual parsing, bounded ranges, calendar/elapsed DST, ambiguity and full value checks passed')
assert.equal(value('in 1 day', '2026-10-31T16:00:00Z', 'America/New_York').epoch, Date.parse('2026-11-01T17:00:00Z'))
assert.equal(value('in 24 hours', '2026-10-31T16:00:00Z', 'America/New_York').epoch, Date.parse('2026-11-01T16:00:00Z'))
assert.equal(value('0 days ago', '2026-11-01T06:30:00Z', 'America/New_York').epoch, Date.parse('2026-11-01T06:30:00Z'))
assert.equal(value('1天后', '2026-01-31T23:59:59Z').target, '2026-02-01 23:59:59 UTC+00:00')
