#!/usr/bin/env node
/**
 * Contract: learned url-templates become editable quick-open rules.
 *   src/plugins/web-open/learnedRules.ts
 *
 * The learner discovers "type an MR number → open that MR". web-open already
 * owns that concept, so it claims the rule and stores it as a normal quick-open
 * entry — one list, editable, instead of a second delete-only store.
 *
 * THE LOAD-BEARING TEST is the cross-layer one at the bottom: the host decides a
 * token's slot kind with classifyTokenSlot, while the plugin matches it with a
 * regex. If those two disagree, a rule is learned and then never fires — exactly
 * the silent failure fixed earlier in urlTemplate.ts. So every representative
 * token for a slot kind MUST match the pattern generated for that kind.
 *
 * Run: node scripts/test-web-open-learned-rules.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
function loadModule(path) {
  const out = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const moduleExports = {}
  // learnedRules.ts imports AUTO_CREATED_TAG as a VALUE (not a type), so the
  // require survives transpilation and the sandbox has to resolve it.
  const requireShim = (id) => {
    if (id.endsWith('settings/model')) return loadModule('src/plugins/web-open/settings/model.ts')
    throw new Error('unexpected require: ' + id)
  }
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    require: requireShim,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const L = loadModule('src/plugins/web-open/learnedRules.ts')
const U = loadModule('src/workspace/learning/urlTemplate.ts')
const C = loadModule('src/workspace/learning/coverage.ts')
const webOpenIndex = read('src/plugins/web-open/index.tsx')

assert.match(
  webOpenIndex,
  /const keywordMatches = entries[\s\S]{0,180}\.filter\(\(entry\) => !entry\.learnedFrom\)/,
  'learned rules must only fire through matchPattern, not ordinary title search',
)

const offer = (over = {}) => ({
  kind: 'url-template',
  template: 'code.byted.org/lark/-/merge_requests/{n}',
  slotKind: 'n',
  clusterKey: 'url:code.byted.org/lark/-/merge_requests/{n}',
  evidence: { sampleCount: 27, distinctInputs: 7 },
  ...over,
})

// ─── 1. a learned offer becomes a usable quick-open entry ────────────────────
{
  const entry = L.learnedOfferToEntry(offer())
  assert.ok(entry, 'url-template offer converts')
  assert.equal(
    entry.urlTemplate,
    'https://code.byted.org/lark/-/merge_requests/{query}',
    'slot becomes {query} and the scheme is restored',
  )
  assert.ok(entry.matchPattern, 'carries a match pattern so it only fires on the right shape')
  assert.equal(entry.encodeQuery, false, 'ids must not be percent-encoded into garbage')
  assert.equal(entry.emptyQueryBehavior, 'block', 'empty input must not open the bare template')
  assert.equal(entry.learnedFrom, offer().clusterKey, 'remembers which cluster taught it')
  assert.ok(
    entry.tags?.includes('auto'),
    'carries the auto-created tag — the user must never wonder where a rule they did not write came from',
  )
  assert.ok(entry.id.length > 0, 'has a stable id')
  assert.ok(entry.title.includes('code.byted.org'), 'titled by host — neutral, needs no translation')
}

// ─── 2. ids are stable and derived from the cluster (idempotent claiming) ────
{
  const a = L.learnedOfferToEntry(offer())
  const b = L.learnedOfferToEntry(offer())
  assert.equal(a.id, b.id, 'same offer → same id, so re-claiming cannot duplicate')

  const other = L.learnedOfferToEntry(offer({ clusterKey: 'url:other.org/x/{n}', template: 'other.org/x/{n}' }))
  assert.notEqual(a.id, other.id, 'different clusters get different ids')
}

// ─── 3. query-slot templates survive the round trip ──────────────────────────
{
  const entry = L.learnedOfferToEntry(offer({
    template: 'argos.byted.org/trace?logid={hex}',
    slotKind: 'hex',
    clusterKey: 'url:argos.byted.org/trace?logid={hex}',
  }))
  assert.equal(
    entry.urlTemplate,
    'https://argos.byted.org/trace?logid={query}',
    'a slot inside the query string converts too',
  )
}

// ─── 4. junk in, nothing out ─────────────────────────────────────────────────
{
  assert.equal(L.learnedOfferToEntry(offer({ kind: 'chain' })), null, 'only url-templates convert')
  assert.equal(L.learnedOfferToEntry(offer({ template: 'no-slot-here.org/x' })), null, 'a template with no slot is useless')
  assert.equal(L.learnedOfferToEntry(offer({ template: '' })), null, 'empty template rejected')
  assert.equal(L.learnedOfferToEntry(offer({ slotKind: 'nonsense' })), null, 'unknown slot kind rejected')
}

// ─── 5. merging into existing entries: no duplicates, user edits preserved ───
{
  const entry = L.learnedOfferToEntry(offer())
  const existing = [
    { id: 'web-1', title: 'Google', aliases: ['g'], urlTemplate: 'https://google.com/search?q={query}' },
  ]

  const merged = L.mergeLearnedEntry(existing, entry)
  assert.equal(merged.length, 2, 'the learned rule is appended')
  assert.equal(merged[0].id, 'web-1', 'existing rules are untouched')

  const again = L.mergeLearnedEntry(merged, entry)
  assert.equal(again.length, 2, 'claiming the same rule twice does not duplicate it')
  assert.equal(again, merged, 'an unchanged merge returns the same array (no pointless write)')

  // If the user edited the learned rule, re-claiming must not clobber their edit.
  const edited = merged.map((e) =>
    e.learnedFrom ? { ...e, title: 'My MRs', urlTemplate: 'https://code.byted.org/custom/{query}' } : e,
  )
  const afterEdit = L.mergeLearnedEntry(edited, entry)
  assert.equal(afterEdit, edited, 'user edits to a learned rule are never overwritten')
}

// ─── 6. CROSS-LAYER: host slot kinds and plugin regexes must agree ───────────
// If these drift, rules get learned and silently never fire.
{
  for (const slotKind of ['n', 'hex', 'uuid', 'id', 'slug']) {
    const entry = L.learnedOfferToEntry(offer({
      template: `x.org/a/{${slotKind}}`,
      slotKind,
      clusterKey: `url:x.org/a/{${slotKind}}`,
    }))
    assert.ok(entry, `${slotKind}: converts`)
    const re = new RegExp(entry.matchPattern)

    for (const token of C.representativeTokens(slotKind)) {
      // Sanity: the host itself classifies this token as this kind.
      assert.equal(
        U.classifyTokenSlot(token),
        slotKind,
        `${slotKind}: representative token "${token}" must classify as its own kind`,
      )
      // The load-bearing assertion.
      assert.ok(
        re.test(token),
        `${slotKind}: host would fire on "${token}" but the plugin pattern ${entry.matchPattern} does not match it`,
      )
    }
  }
}

// ─── 7. patterns stay discriminating (a slot kind is not a catch-all) ────────
{
  const patternFor = (slotKind) =>
    new RegExp(L.learnedOfferToEntry(offer({
      template: `x.org/a/{${slotKind}}`,
      slotKind,
      clusterKey: `k:${slotKind}`,
    })).matchPattern)

  assert.equal(patternFor('n').test('claude-code'), false, '{n} must not match text')
  assert.equal(patternFor('uuid').test('12345'), false, '{uuid} must not match a plain number')
  // A bare word is never a slot value anywhere (guardrail mirrored from the host).
  for (const kind of ['n', 'hex', 'uuid', 'id', 'slug']) {
    assert.equal(
      patternFor(kind).test('hello'),
      false,
      `{${kind}} must not match a bare word — every search query would open a page`,
    )
  }
}

// ─── 8. the auto tag is declared, localized, and survives migration ──────────
// A tag that renders but doesn't survive a settings migration is worse than
// none: the marker silently disappears and a system rule starts looking
// hand-written.
{
  const index = readFileSync(new URL('../src/plugins/web-open/index.tsx', import.meta.url), 'utf8')
  assert.match(index, /itemTagsKey: 'tags'/, 'rules list renders the tags field')
  assert.match(index, /itemTagLabelsI18n/, 'tag labels are localized, not persisted')
  assert.match(index, /zh: '自动创建'/, 'auto tag has Chinese copy')
  assert.match(
    index,
    /tags: Array\.isArray\(source\.tags\)/,
    'tags survive the settings migration (migrate rebuilds every entry)',
  )

  const model = readFileSync(new URL('../src/plugins/web-open/settings/model.ts', import.meta.url), 'utf8')
  assert.match(model, /AUTO_CREATED_TAG = 'auto'/, 'the reserved tag value is a named constant')
  assert.match(model, /tags\?: string\[\]/, 'entries carry tags')
}

console.log('test-web-open-learned-rules: ok')
