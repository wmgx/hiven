#!/usr/bin/env node
/** Package-4 polish: chip trail, shared destinations, plugins empty well */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chip = readFileSync('src/components/launcher/LauncherCommandTag.tsx', 'utf8')
const dest = readFileSync('src/components/launcher/LauncherOutputTargets.tsx', 'utf8')
const collect = readFileSync('src/components/launcher/GlobalLauncherCollectInputFrame.tsx', 'utf8')
const result = readFileSync('src/components/launcher/GlobalLauncherResultFrame.tsx', 'utf8')
const param = readFileSync('src/components/launcher/LauncherParamStep.tsx', 'utf8')
const plugins = readFileSync('src/surfaces/PluginsContent.tsx', 'utf8')
const css = readFileSync('src/index.css', 'utf8')

assert.match(chip, /LauncherParamChipTrail/, 'chip trail helper')
assert.match(chip, /MAX_VISIBLE_PARAM_CHIPS|maxVisible/, 'overflow limit')
assert.match(chip, /launcher-param-chip-more/, '+N overflow chip')

assert.match(dest, /buildOutputDestinations/, 'shared destination builder')
assert.match(dest, /LauncherOutputTargetsBar/, 'shared bar')
assert.match(dest, /LauncherOutputTargetsFooter/, 'shared footer')
assert.match(dest, /useOutputDestinations/, 'shared hook')
assert.match(dest, /⇧↵/, 'shift-enter paste key')
assert.match(dest, /return-to-launcher/, 'return destination')

assert.match(collect, /LauncherParamChipTrail/, 'collect uses chip trail')
assert.match(collect, /LauncherOutputTargetsBar/, 'collect uses shared bar')
assert.match(collect, /useOutputDestinations/, 'collect uses shared hook')
assert.doesNotMatch(collect, /function buildDestinations/, 'collect no longer owns destinations')

assert.match(result, /LauncherOutputTargetsBar/, 'result uses shared bar')
assert.match(result, /useOutputDestinations/, 'result uses shared hook')
assert.match(result, /LauncherOutputTargetsFooter/, 'result uses shared footer')

assert.match(param, /LauncherParamChipTrail/, 'param step uses chip trail')

assert.match(plugins, /LauncherEmptyWell/, 'plugins empty uses empty well')
assert.match(plugins, /plugins-empty-well/, 'plugins empty test id')

assert.match(css, /launcher-param-chip-trail/, 'chip trail styles')
assert.match(css, /launcher-param-chip-more/, 'overflow chip styles')

console.log('package-4 polish contracts passed')
