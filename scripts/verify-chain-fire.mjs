#!/usr/bin/env node
/**
 * Headless proof of the scenario-B chain fire, faithful to the production runners:
 *   encode-decode:url.decode  = decodeURIComponent, textMatch = has %XX
 *   json-tools:json.prettify  = JSON.stringify(JSON.parse, null, 2), textMatch = parseable
 * and the exact runLearnedChain sequencing (textMatch gate + null-on-decline +
 * no-op guard). Lets us verify the collapsed result WITHOUT the running app.
 *
 * Run: node scripts/verify-chain-fire.mjs
 */
import assert from 'node:assert/strict'

const runners = {
  'encode-decode:url.decode': {
    textMatch: (t) => /%[0-9a-fA-F]{2}/.test(t),
    run: (t) => {
      try { const d = decodeURIComponent(t); return d !== t ? d : null } catch { return null }
    },
  },
  'json-tools:json.prettify': {
    textMatch: (t) => { try { JSON.parse(t); return true } catch { return false } },
    run: (t) => {
      try { return JSON.stringify(JSON.parse(t), null, 2) } catch { return null }
    },
  },
}

// Exact copy of runLearnedChain (src/workspace/learning/registryRunners.ts).
function runLearnedChain(toolIds, text) {
  if (toolIds.length === 0) return null
  let current = text
  const trace = [text]
  for (const id of toolIds) {
    const runner = runners[id]
    if (!runner) return { result: null, trace, missing: id }
    if (runner.textMatch && !runner.textMatch(current)) return { result: null, trace, declinedAt: id }
    const next = runner.run(current)
    if (next == null) return { result: null, trace, nullAt: id }
    current = next
    trace.push(current)
  }
  return { result: current === text ? null : current, trace }
}

const input = '%7B%22b%22%3A2%2C%22a%22%3A1%7D' // {"b":2,"a":1} url-encoded
const out = runLearnedChain(['encode-decode:url.decode', 'json-tools:json.prettify'], input)

console.log('input:   ', input)
out.trace.forEach((step, i) => {
  if (i === 0) return
  console.log(`step ${i}:  `, JSON.stringify(step))
})
console.log('result:  ')
console.log(out.result)

assert.ok(out.result, 'chain produced a collapsed result')
assert.equal(out.result, '{\n  "b": 2,\n  "a": 1\n}', 'url-decode → json-prettify collapsed correctly')

// Guards behave: unrelated input declines; missing tool reported.
assert.equal(runLearnedChain(['encode-decode:url.decode', 'json-tools:json.prettify'], 'plain text').result, null)
assert.equal(runLearnedChain(['nope:missing'], input).missing, 'nope:missing')

console.log('\nverify-chain-fire: ok — the chain collapses url-decode → json-prettify into one result.')
