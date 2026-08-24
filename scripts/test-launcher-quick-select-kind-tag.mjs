#!/usr/bin/env node
/**
 * Contract: meaningful kind pills (open tab / history / window / process / …)
 * must stay visible on the first eight launcher rows even though those rows
 * also show the ⌘1…⌘8 quick-select badge — but the two must not render as
 * two separate floating chips. When both apply, ⌘N folds into the tag pill
 * (r-tag-combo / r-quick-select-inline) instead of sitting beside it.
 *   src/components/launcher/LauncherMixedList.tsx
 *
 * Before this contract, ANY kind pill was hidden whenever a row carried a
 * quickSelectLabel ("Prefer ⌘N over noisy kind pills"). That made sense for
 * the generic App/Command fallback every plain command row would otherwise
 * show, but it also hid the one signal (Open tab vs History vs Window vs …)
 * that tells otherwise-identical rows apart — exactly the top-ranked rows a
 * user is most likely to quick-select. A later pass showed both as separate
 * adjacent chips, which read as crowded — they were folded into one pill.
 *
 * Run: node scripts/test-launcher-quick-select-kind-tag.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/components/launcher/LauncherMixedList.tsx', import.meta.url), 'utf8')

// ─── a meaningful-tag detector exists and is wired into the row ──────────────
{
  assert.match(
    src,
    /function hasMeaningfulKindTag\(item: LauncherMixedItem\): boolean/,
    'must define a helper distinguishing real kind pills from the generic App/Command fallback',
  )
  assert.match(
    src,
    /const hasKindTagOverride = hasMeaningfulKindTag\(item\)/,
    'row render must compute hasKindTagOverride from the item',
  )
  // The detector must key off display.kindLabelI18n / kindLabel (host-provided
  // override), not off item.kind alone — plain commands never set these.
  assert.match(src, /display\?\.kindLabelI18n/, 'detector must read kindLabelI18n from domain display')
  assert.match(src, /display\?\.kindLabel\?\.trim\(\)/, 'detector must also accept a plain kindLabel override')
}

// ─── the kind pill renders when there is no quick-select OR the tag is meaningful ─
{
  assert.match(
    src,
    /const showTag = !quickSelectLabel \|\| hasKindTagOverride/,
    'kind pill must render for meaningful tags even when the ⌘N quick-select badge is also shown',
  )
  // Must not regress to the old "hide any tag whenever quick-select is present" rule.
  assert.doesNotMatch(
    src,
    /\{!quickSelectLabel && \(\s*\n\s*<span className="r-tag launcher-kind-tag">/,
    'must not reintroduce the old quick-select-always-hides-tag behavior',
  )
}

// ─── tag + ⌘N fold into one pill instead of two adjacent floating chips ─────
{
  assert.match(
    src,
    /const combineTagAndQuickSelect = showTag && showQuickSelect/,
    'must compute a combine flag for the both-present case',
  )
  assert.match(
    src,
    /className=\{`r-tag launcher-kind-tag\$\{combineTagAndQuickSelect \? ' r-tag-combo' : ''\}`\}/,
    'tag pill must switch to combo styling when it also carries ⌘N',
  )
  // ⌘N must still be present somewhere on the row when combined — nested
  // inside the tag pill, not dropped.
  assert.match(
    src,
    /\{combineTagAndQuickSelect && \(\s*\n\s*<kbd className=\{`r-quick-select-inline/,
    '⌘N must render inside the tag pill when combined, not disappear',
  )
  // When NOT combined (no meaningful tag on a quick-select row), the standalone
  // badge is still the one that renders.
  assert.match(
    src,
    /\{showQuickSelect && !combineTagAndQuickSelect && \(\s*\n\s*<kbd className=\{`r-shortcut-badge r-quick-select/,
    'standalone ⌘N badge must still render when there is no tag to fold into',
  )
}

console.log('test-launcher-quick-select-kind-tag: ok')
