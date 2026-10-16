#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/plugins/date-time-assistant/index.ts', 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
    esModuleInterop: true,
  },
}).outputText

let fixedEpochMs = Date.UTC(2026, 5, 10, 4, 5, 6)
class FixedDate extends Date {
  constructor(value) {
    super(value === undefined ? fixedEpochMs : value)
  }
  static now() {
    return fixedEpochMs
  }
}
FixedDate.UTC = Date.UTC
FixedDate.parse = Date.parse

const zoneModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/date-time-assistant/timeZoneAnswer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText, { module: zoneModule, exports: zoneModule.exports, Date: FixedDate, Intl })
const cronModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/date-time-assistant/cronAnswer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText, { module: cronModule, exports: cronModule.exports, Date: FixedDate, Intl })
const relativeModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/date-time-assistant/relativeTimeAnswer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText, { module: relativeModule, exports: relativeModule.exports, Date: FixedDate, Intl })
const module = { exports: {} }
const context = vm.createContext({
  Date: FixedDate,
  Number,
  Math,
  String,
  RegExp,
  parseInt,
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === './relativeTimeAnswer') return relativeModule.exports
    if (specifier === './cronAnswer') return cronModule.exports
    if (specifier === './timeZoneAnswer') return zoneModule.exports
    if (specifier === '@hiven/plugin') {
      return {
        definePlugin: (definition) => definition,
        textOutput: (text) => ({ output: { kind: 'text', text } }),
        textError: (text) => ({ output: { kind: 'error', text } }),
      }
    }
    throw new Error(`Unexpected require: ${specifier}`)
  },
})

vm.runInContext(transpiled, context, { filename: 'date-time-assistant.js' })

const plugin = module.exports.default
const convertForSurface = module.exports.convertForSurface
const provider = plugin.launcher?.dynamicItems
assert.ok(provider, 'date-time assistant should expose the launcher dynamic item provider')
const timestampCommand = plugin.commands?.find((item) => item.id === 'timestamp.run')
assert.ok(timestampCommand, 'date-time assistant should expose the timestamp conversion command')
assert.equal(typeof convertForSurface, 'function', 'date-time assistant should expose the surface converter')

async function values(query) {
  const translate = (key) => key
  const items = await provider({ query, locale: 'en', settings: {}, t: translate })
  const copied = []
  const api = {
    copyText: async (text) => { copied.push(text) },
  }
  for (const item of items) {
    await item.execute({ api, locale: 'en', settings: {}, t: translate })
  }
  return copied
}

assert.equal(
  JSON.stringify(await values('now')),
  JSON.stringify(['1781064306000', '2026-06-10 12:05:06']),
  'now should offer separate timestamp and datetime suggestions',
)
assert.equal(
  JSON.stringify(await values('now+1day')),
  JSON.stringify(['1781150706000', '2026-06-11 12:05:06']),
  'now+1day should offer separate adjusted timestamp and datetime suggestions',
)
assert.equal(
  JSON.stringify(await values('now+12h')),
  JSON.stringify(['1781107506000', '2026-06-11 00:05:06']),
  'now+12h should offer separate adjusted timestamp and datetime suggestions',
)
assert.equal(
  JSON.stringify(await values('now UTC+8')),
  JSON.stringify(['1781064306000', '2026-06-10 12:05:06+08:00']),
  'now UTC+8 should offer separate timestamp and timezone datetime suggestions',
)
assert.equal(
  JSON.stringify(await values('2026-06-10 12:05:06+08:00')),
  JSON.stringify(['1781064306000', '1781064306']),
  'timezone datetime query should directly offer millisecond and second timestamp suggestions',
)
assert.equal(
  JSON.stringify(await values('2026-06-10 12:05:06 UTC+8')),
  JSON.stringify(['1781064306000', '1781064306']),
  'UTC+8 datetime query should directly offer millisecond and second timestamp suggestions',
)
assert.equal(
  JSON.stringify(await values('2026-06-10 12:05:06 UTC+08:00')),
  JSON.stringify(['1781064306000', '1781064306']),
  'UTC+08:00 datetime query should match UTC+8',
)
assert.equal(
  JSON.stringify(await values('2026-06-10 12:05:06 GMT+8')),
  JSON.stringify(['1781064306000', '1781064306']),
  'GMT+8 datetime query should match UTC+8',
)
assert.equal(
  JSON.stringify(await values('2026-06-10 12:05:06 +8')),
  JSON.stringify(['1781064306000', '1781064306']),
  'bare +8 datetime query should match UTC+8',
)
function runTimestampCommand(text) {
  const result = timestampCommand.run({
    inputs: { input: { kind: 'text', text, paneId: 'pane-test' } },
    params: { unit: 'ms', overwrite: 'yes' },
  })
  if (result.output) return result.output.text
  return result.effects?.[0]?.text
}

function runTimestampCommandOutput(text) {
  return timestampCommand.run({
    inputs: { input: { kind: 'text', text, paneId: 'pane-test' } },
    params: { unit: 'ms', overwrite: 'yes' },
  }).output
}

assert.equal(
  runTimestampCommand(['now', 'now+1day', 'now+12h', 'now UTC+8'].join('\n')),
  [
    '1781064306000 | 2026-06-10 12:05:06',
    '1781150706000 | 2026-06-11 12:05:06',
    '1781107506000 | 2026-06-11 00:05:06',
    '1781064306000 | 2026-06-10 12:05:06+08:00',
  ].join('\n'),
  'timestamp command should share now expression handling with instant suggestions',
)
assert.equal(
  runTimestampCommand('2026-06-10 12:05:06 UTC+8'),
  '1781064306000',
  'timestamp command should parse UTC+8 datetime suffixes',
)
assert.equal(runTimestampCommandOutput('not-a-date')?.kind, 'error', 'invalid dates must not become replaceable text output')

assert.equal(
  JSON.stringify(convertForSurface('2026-06-10 12:05:06 UTC+8', 'UTC')),
  JSON.stringify({
    ok: true,
    value: {
      dateTime: '2026-06-10 12:05:06+08:00',
      unixSeconds: '1781064306',
      unixMilliseconds: '1781064306000',
      offsetLabel: 'UTC+08:00',
    },
  }),
  'surface conversion should produce date, seconds, and milliseconds together',
)
assert.equal(
  JSON.stringify(convertForSurface('2026-06-10T04:05:06Z', 'UTC+8')),
  JSON.stringify({
    ok: true,
    value: {
      dateTime: '2026-06-10 04:05:06+00:00',
      unixSeconds: '1781064306',
      unixMilliseconds: '1781064306000',
      offsetLabel: 'UTC+00:00',
    },
  }),
  'surface conversion should not apply the selected offset twice to an ISO UTC value',
)

const parseZone = zoneModule.exports.parseTimeZoneAnswer
const zone = (text) => {
  const result = parseZone(text, new FixedDate())
  assert.equal(result?.ok, true, text)
  return result.value
}
const est = zone('3pm EST')
assert.equal(est.sourceDate, '2026-06-09', 'omitted date uses the current date in the source zone')
assert.equal(est.offsetMinutes, -300)
assert.equal(est.targets[0].date, '2026-06-10')
assert.equal(est.targets[0].time, '04:00')
assert.equal(est.targets[0].dayDelta, 1)
assert.equal(est.targets[1].time, '05:00')
assert.equal(est.targets[2].time, '20:00')
assert.equal(zone('2026-07-01 3pm EST').offsetMinutes, -300)
assert.equal(zone('2026-07-01 3pm America/New_York').offsetMinutes, -240)
assert.equal(zone('2026-01-01 3pm America/New_York').offsetMinutes, -300)
assert.equal(zone('2026-01-01 00:15 UTC+14').targets[2].dayDelta, -1)
assert.equal(zone('2026-01-01 12am UTC').sourceTime, '00:00')
assert.equal(zone('2026-01-01 12pm UTC').sourceTime, '12:00')
assert.equal(zone('2026-01-01 15:30 Asia/Kolkata').offsetMinutes, 330)
assert.equal(zone('1991-07-01 15:00 UTC').targets[0].time, '00:00', 'Beijing follows historical Shanghai daylight saving')
assert.equal(zone('1991-07-01 15:00 UTC').targets[0].dayDelta, 1)
assert.equal(zone('1950-07-01 15:00 UTC').targets[1].time, '01:00', 'Tokyo follows historical daylight saving')
assert.equal(zone('1900-01-01 15:00 Asia/Shanghai').targets[2].time, '06:54:17', 'historical second offsets retain precision')
for (const text of ['3pm CST', '3pm IST', '3pm EDT', '3pm Not/A_Zone', '3pm UTC+14:01']) {
  assert.equal(parseZone(text)?.error, 'zone', text)
}
for (const text of ['2026-02-30 3pm EST', '2026-01-01 24:00 UTC', '0am UTC', '13pm EST', '15:60 UTC']) {
  assert.equal(parseZone(text)?.error, 'date', text)
}
assert.equal(parseZone('2026-03-08 02:30 America/New_York')?.error, 'gap')
assert.equal(parseZone('2026-11-01 01:30 America/New_York')?.error, 'fold')
assert.equal(parseZone('2026-04-05 01:45 Australia/Lord_Howe')?.error, 'fold')
assert.equal(parseZone('2026-10-04 02:15 Australia/Lord_Howe')?.error, 'gap')
assert.equal(parseZone('now'), null)
assert.equal(parseZone('2026-06-10 12:05:06 UTC+8'), null)
const zoneCopies = await values('3pm EST')
assert.equal(zoneCopies.length, 1)
assert.ok(zoneCopies[0].includes('2026-06-09 15:00 EST (UTC-05:00)'))
assert.ok(zoneCopies[0].includes('2026-06-10 04:00'))
const badItems = await provider({ query: '3pm CST', locale: 'en', settings: {}, t: (key) => key })
assert.equal(badItems.length, 1)
const badResult = await badItems[0].execute({ api: { copyText() { assert.fail('invalid zone must not copy') } } })
assert.equal(badResult.ok, false)
console.log('date time assistant checks passed')

assert.equal((await values('*/5 * * * *')).length, 1, 'Cron returns one keyboard-copy action')
assert.match((await values('*/5 * * * *'))[0], /^\*\/5 \* \* \* \* ·/)
assert.equal((await values('0 0 ? * MON')).length, 0, 'Invalid cron must not copy')

const initialEpoch = fixedEpochMs
const cronTranslate = (key, args = {}) => `${key} ${JSON.stringify(args)}`
const idleCron = (await provider({ query: '*/5 * * * *', locale: 'en', settings: {}, t: cronTranslate }))[0]
assert.match(idleCron.display.title, /2026-06-10 12:10:00/)
assert.match(idleCron.display.title, /^cron.next /, 'next occurrence leads the answer, before scheduling details')
assert.doesNotMatch(idleCron.display.title, /cron.everyMinutes|cron.fields/, 'field descriptions do not displace the requested time')
assert.match(idleCron.display.subtitle, /^cron.copy .*cron.everyMinutes .*cron.dayRule /, 'copy action and complete rules remain available as details')
fixedEpochMs += 7 * 60_000
const freshCopies = []
const idleResult = await idleCron.execute({ api: { copyText: async (text) => freshCopies.push(text) } })
assert.equal(idleResult.ok, true)
assert.equal(freshCopies.length, 1)
assert.match(freshCopies[0], /2026-06-10 12:15:00/)
assert.doesNotMatch(freshCopies[0], /2026-06-10 12:10:00/)
assert.match(freshCopies[0], /Asia\/Shanghai/)
fixedEpochMs = NaN
const invalidNowResult = await idleCron.execute({ api: { copyText: async () => assert.fail('Failed refresh must not copy the cached next occurrence') } })
assert.equal(invalidNowResult.ok, false)
assert.match(invalidNowResult.message, /cron.error.syntax/)
fixedEpochMs = initialEpoch
console.log('Cron dynamic execution refresh and failure checks passed')

const relativeItem = (await provider({ query: '3天前', locale: 'zh', settings: {}, t: cronTranslate }))[0]
assert.match(relativeItem.display.title, /2026-06-07 12:05:06 UTC\+08:00/)
assert.match(relativeItem.display.subtitle, /2026-06-10 12:05:06 UTC\+08:00/)
fixedEpochMs += 60_000
const relativeCopies = []
await relativeItem.execute({ api: { copyText: async (text) => relativeCopies.push(text) } })
assert.match(relativeCopies[0], /2026-06-07 12:05:06 UTC\+08:00/)
assert.match(relativeCopies[0], /2026-06-10 12:05:06 UTC\+08:00/)
assert.match(relativeCopies[0], /Asia\/Shanghai/)
const changedRelative = (await provider({ query: 'in 3 hours', locale: 'en', settings: {}, t: cronTranslate }))[0]
await changedRelative.execute({ api: { copyText: async (text) => relativeCopies.push(text) } })
assert.match(relativeCopies[1], /2026-06-10 15:06:06 UTC\+08:00/)
assert.doesNotMatch(relativeCopies[1], /2026-06-07/)
assert.equal((await values('1 month ago')).length, 0)
fixedEpochMs = initialEpoch
console.log('Relative dynamic answers keep an explicit base, copy full values, and respond to changed input')

// Only this process changes TZ; the system clock and desktop timezone stay intact.
const originalTimeZone = process.env.TZ
try {
  const cases = [
    ['UTC', '2025-12-31T10:30:00.000Z', '2025-12-31 10:30:00+00:00'],
    ['Asia/Kathmandu', '2025-12-31T10:30:00.123Z', '2025-12-31 16:15:00.123+05:45'],
    ['America/New_York', '2026-01-15T12:00:00.000Z', '2026-01-15 07:00:00-05:00'],
    ['America/New_York', '2026-07-15T12:00:00.000Z', '2026-07-15 08:00:00-04:00'],
    ['America/New_York', '2026-11-01T05:30:00.000Z', '2026-11-01 01:30:00-04:00'],
    ['America/New_York', '2026-11-01T06:30:00.000Z', '2026-11-01 01:30:00-05:00'],
  ]
  for (const [zone, iso, expected] of cases) {
    process.env.TZ = zone
    const epoch = Date.parse(iso)
    const queries = [String(epoch), `timestamp ${epoch}`]
    if (epoch % 1000 === 0) queries.push(String(epoch / 1000))
    for (const query of queries) {
      const items = await provider({ query, locale: 'en', settings: {}, t: (key) => key })
      assert.equal(items.length, 1)
      const item = items[0]
      assert.equal(item.display.title, `${query} -> ${expected}`)
      const copies = []
      const result = await item.execute({ api: { copyText: async (text) => copies.push(text) } })
      await result.output.choices[0].primaryAction()
      assert.deepEqual(copies, [expected, expected], 'both copy paths equal the displayed offset-bearing value')
      assert.equal(Date.parse(copies[0].replace(' ', 'T')), epoch, 'copied value uniquely identifies the original instant')
      assert.ok((await values(copies[0])).includes(String(epoch)), 're-search preserves the timestamp value and milliseconds')
    }
  }
} finally {
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
}
console.log('Timestamp answers retain target-time DST offset, repeated-hour identity and millisecond precision through both copies')

const calendarOriginalTZ = process.env.TZ
try {
  const explicitCases = [
    ['2000-01-01T00:00:00Z', '2000-01-01T00:00:00.000Z'],
    ['2026-03-08 02:30:00+00:00', '2026-03-08T02:30:00.000Z'],
    ['2026-03-08 02:30:00 UTC+0', '2026-03-08T02:30:00.000Z'],
    ['2026-03-08T02:30:00Z', '2026-03-08T02:30:00.000Z'],
    ['2026-03-08 02:30:00Z', '2026-03-08T02:30:00.000Z'],
    ['2026-11-01 01:30:00-04:00', '2026-11-01T05:30:00.000Z'],
    ['2026-11-01 01:30:00-05:00', '2026-11-01T06:30:00.000Z'],
    ['2026-1-1 00:30:00.1 GMT+14', '2025-12-31T10:30:00.100Z'],
    ['2026-01-01 00:30:00.12+14:00', '2025-12-31T10:30:00.120Z'],
    ['2024-2-29 UTC+0', '2024-02-29T00:00:00.000Z'],
  ]
  const invalid = ['2026-02-30 02:30:00+00:00', '2026-02-30 02:30:00Z', '2025-02-29T00:00:00Z',
    '2026-13-01 00:00:00+00:00', '2026-01-00 00:00:00+00:00',
    '2026-03-08 24:00:00+00:00', '2026-03-08 02:60:00+00:00',
    '2026-03-08 02:30:60+00:00', '2026-03-08 02:30:00+14:01',
    '2026-03-08 02:30:00 UTC+25', '2026-03-08 02:30:00 +',
    '2026-03-08T02:30:00Z+08:00', '2026-03-08T02:30:00+08:00Z',
    '2026-03-08 02:30:00 UTC+8 +09:00']
  for (const zone of ['UTC', 'America/New_York', 'Asia/Shanghai']) {
    process.env.TZ = zone
    for (const [input, iso] of explicitCases) {
      const expected = String(Date.parse(iso))
      assert.ok((await values(input)).includes(expected), `${zone}: instant ${input}`)
      assert.equal(runTimestampCommand(input), expected, `${zone}: command ${input}`)
      assert.equal(convertForSurface(input, 'UTC+8').value?.unixMilliseconds, expected, `${zone}: surface ${input}`)
    }
    for (const input of invalid) {
      assert.deepEqual(await values(input), [], `${zone}: invalid instant ${input}`)
      assert.equal(runTimestampCommandOutput(input)?.kind, 'error', `${zone}: invalid command ${input}`)
      assert.equal(convertForSurface(input, 'UTC+8').ok, false, `${zone}: invalid surface ${input}`)
    }
    for (const input of ['2026-03-08 02:30:00', '2026-03-08']) {
      const expected = String(new Date(input).getTime())
      assert.ok((await values(input)).includes(expected), 'unqualified instant dates retain existing local Date semantics')
      assert.equal(runTimestampCommand(input), expected, 'unqualified command dates retain existing local Date semantics')
    }
    assert.equal(convertForSurface('2026-03-08 02:30:00', 'UTC').value?.unixMilliseconds,
      String(Date.parse('2026-03-08T02:30:00Z')), 'surface-selected offset also avoids host DST normalization')
  }
} finally {
  if (calendarOriginalTZ === undefined) delete process.env.TZ
  else process.env.TZ = calendarOriginalTZ
}
console.log('Explicit calendar offsets are host-independent; invalid fields/offsets rejected and unqualified local semantics preserved')
