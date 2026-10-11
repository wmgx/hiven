import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = ts.transpileModule(readFileSync('src/plugins/date-time-assistant/cronAnswer.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 } }).outputText
const { parseCronAnswer: parse } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const next = (query, now, zone = 'UTC') => {
  const result = parse(query, new Date(now), zone)
  assert.equal(result?.ok, true, JSON.stringify(result))
  assert.ok(result.value.epoch > Date.parse(now))
  return result.value
}
assert.equal(next('*/5 * * * *', '2026-10-11T12:05:00Z').epoch, Date.parse('2026-10-11T12:10:00Z'))
assert.equal(next('*/5 * * * *', '2026-10-11T12:04:59.999Z').everyMinutes, 5)
assert.equal(next('*/7 * * * *', '2026-10-11T12:56:00Z').everyMinutes, undefined)
assert.equal(next('0,15,30-45/15 9-17/2 * JAN,MAR MON-FRI', '2026-01-02T09:30:00Z').epoch, Date.parse('2026-01-02T09:45:00Z'))
assert.equal(next('0 0 13 * MON', '2026-10-11T23:59:59Z').epoch, Date.parse('2026-10-12T00:00:00Z'))
assert.equal(next('0 0 13 * MON', '2026-10-12T00:00:00Z').epoch, Date.parse('2026-10-13T00:00:00Z'))
assert.equal(next('0 0 13 * MON', '2026-10-12T00:00:00Z').dayOr, true)
assert.equal(next('0 0 * * 7', '2026-10-10T23:59:59Z').epoch, next('0 0 * * SUN', '2026-10-10T23:59:59Z').epoch)
assert.equal(next('0 0 29 FEB *', '2096-02-29T00:00:00Z').epoch, Date.parse('2104-02-29T00:00:00Z'))
assert.deepEqual(parse('0 0 30 FEB *', new Date('2026-01-01Z'), 'UTC'), { ok: false, error: 'unreachable' })
// New York spring gap skips nonexistent 02:30; fall fold includes both real instants.
assert.equal(next('30 2 * * *', '2026-03-08T06:59:00Z', 'America/New_York').epoch, Date.parse('2026-03-09T06:30:00Z'))
assert.equal(next('30 1 * * *', '2026-11-01T05:30:00Z', 'America/New_York').epoch, Date.parse('2026-11-01T06:30:00Z'))
assert.match(next('30 1 * * *', '2026-11-01T05:30:00Z', 'America/New_York').next, /UTC-05:00/)
assert.equal(next('30 1 * * *', '2026-04-04T14:30:00Z', 'Australia/Lord_Howe').epoch, Date.parse('2026-04-04T15:00:00Z'))
assert.equal(next('0 0 * * *', '2011-12-30T09:59:00Z', 'Pacific/Apia').epoch, Date.parse('2011-12-30T10:00:00Z'))
assert.equal(next('0 0 * * *', '2026-10-11T18:00:00Z', 'Asia/Kathmandu').epoch, Date.parse('2026-10-11T18:15:00Z'))
for (const input of ['0 */5 * * * *', '0 0 ? * MON', '0 0 L * *', '0 0 1W * *', '0 0 * * MON#2', '*/0 * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', '0 0 * * FRI-MON', '@daily', 'cron', 'cron * * * *', 'cron * * * * * UTC']) assert.equal(parse(input)?.ok, false, input)
for (const input of ['now', '3pm EST', '2026-07-01 15:00 America/New_York', '2 + 3', 'some ordinary natural language search']) assert.equal(parse(input), null, input)
console.log('Cron parser, strict next occurrence, calendar bounds, and DST checks passed')

// Vixie wildcard flag follows the first character, not the expanded set.
assert.equal(next('0 0 */1 * MON', '2026-10-12T00:00:00Z').epoch, Date.parse('2026-10-19T00:00:00Z'))
assert.equal(next('0 0 */1 * MON', '2026-10-12T00:00:00Z').dayOr, false)
assert.equal(next('0 0 */2 * MON', '2026-10-11T00:00:00Z').epoch, Date.parse('2026-10-19T00:00:00Z'))
assert.equal(next('0 0 */2 * MON', '2026-10-19T00:00:00Z').epoch, Date.parse('2026-11-09T00:00:00Z'))
assert.equal(next('0 0 1-31 * MON', '2026-10-12T00:00:00Z').epoch, Date.parse('2026-10-13T00:00:00Z'))
assert.equal(next('0 0 13 * */2', '2026-10-12T00:00:00Z').dayOr, false)
console.log('Vixie DOM/DOW wildcard-prefix and OR checks passed')
