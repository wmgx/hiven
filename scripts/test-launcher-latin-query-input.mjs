#!/usr/bin/env node
/**
 * Launcher soft latin query input contract.
 *
 * "Soft" is the whole point: the launcher query biases toward Latin so a Chinese
 * IME does not swallow the first keystrokes of a command name, but it must never
 * *block* Chinese — the user still types 中文 to find 中文-named items.
 *
 * The bias used to include inputMode="latin", which is not a valid HTML inputMode
 * value (none | text | tel | url | email | numeric | decimal | search) and was
 * corrected to "text" when tsc debt was cleared. The real bias is carried by
 * lang/autoCapitalize/autoCorrect/spellCheck here, plus the native input-source
 * switch verified in test-launcher-default-english-input-source.mjs.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// LauncherDomainSearchStep and EditorCommandBarHost were deleted in the workbench
// retirement (6e69f0f); the launcher search frame is the only query input left.
const targets = [
  ['GlobalLauncherSearchFrame', 'src/components/launcher/GlobalLauncherSearchFrame.tsx'],
]

for (const [name, path] of targets) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /inputMode="text"/, `${name} should use a valid text input mode`)
  assert.doesNotMatch(source, /inputMode="latin"/, `${name} must not use inputMode="latin" — not a valid HTML value`)
  assert.match(source, /autoCapitalize="none"/, `${name} should not autocapitalize command query`)
  assert.match(source, /autoCorrect="off"/, `${name} should not autocorrect command query`)
  assert.match(source, /spellCheck=\{false\}/, `${name} should disable spellcheck for command query`)
  assert.match(source, /lang="en"/, `${name} should mark query input as English-biased`)
  assert.doesNotMatch(source, /sanitizeLauncherLatinQuery|isLauncherLatinText|replace\([^)]*[^\x00-\x7F]/, `${name} must not block Chinese input; latin is only a default hint`)
}

console.log('launcher soft latin query input checks passed')
