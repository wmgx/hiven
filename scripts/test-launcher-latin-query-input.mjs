#!/usr/bin/env node
/** Launcher soft latin query input contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const targets = [
  ['GlobalLauncherSearchFrame', 'src/components/launcher/GlobalLauncherSearchFrame.tsx'],
  ['LauncherDomainSearchStep', 'src/components/launcher/LauncherDomainSearchStep.tsx'],
  ['EditorCommandBarHost', 'src/launcher/hosts/EditorCommandBarHost.tsx'],
]

for (const [name, path] of targets) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /inputMode="latin"/, `${name} should prefer latin keyboard/input mode for launcher query`)
  assert.match(source, /autoCapitalize="none"/, `${name} should not autocapitalize command query`)
  assert.match(source, /autoCorrect="off"/, `${name} should not autocorrect command query`)
  assert.match(source, /spellCheck=\{false\}/, `${name} should disable spellcheck for command query`)
  assert.match(source, /lang="en"/, `${name} should mark query input as English-biased`)
  assert.doesNotMatch(source, /sanitizeLauncherLatinQuery|isLauncherLatinText|replace\([^)]*[^\x00-\x7F]/, `${name} must not block Chinese input; latin is only a default hint`)
}

console.log('launcher soft latin query input checks passed')
