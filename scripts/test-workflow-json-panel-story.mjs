#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  refactorSuite: read('scripts/test-refactor-suite.mjs'),
  jsonPlugin: read('src/plugins/json-tools/index.ts'),
  jsonSurface: read('src/plugins/json-tools/JsonSurface.tsx'),
  jsonManifest: read('src/plugins/json-tools/manifest.json'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:workflow-json-panel-story'],
  'node scripts/test-workflow-json-panel-story.mjs',
  'package.json must expose test:workflow-json-panel-story',
)
assert.match(files.refactorSuite, /test:workflow-json-panel-story/, 'refactor suite must include JSON panel story coverage')
assert.match(files.jsonPlugin, /import\s+\{\s*JsonSurface\s*\}\s+from\s+['"]\.\/JsonSurface['"]/, 'JSON plugin must import JsonSurface')
assert.match(files.jsonPlugin, /ui:\s*\{[\s\S]*surfaces:\s*\[[\s\S]*id:\s*['"]main['"][\s\S]*component:\s*JsonSurface/, 'JSON plugin must expose a first-class surface')
assert.match(files.jsonManifest, /"surface"/, 'JSON manifest capabilities must include surface')
assert.match(files.jsonSurface, /export function JsonSurface/, 'JsonSurface component must exist')
assert.match(files.jsonSurface, /props\.initialText\?\.trim\(\)/, 'JsonSurface must seed from workflow initialText')
assert.match(files.jsonSurface, /JSON\.parse/, 'JsonSurface must validate/format through JSON.parse')
assert.match(files.jsonSurface, /host\.clipboard\.writeText/, 'JsonSurface must allow copying formatted JSON')
assert.match(files.defaultWorkflowProviders, /textAction\(['"]workflow\.attach-json-panel['"],\s*['"]Attach JSON Panel['"][\s\S]*pluginSurfaceTarget:\s*\{[\s\S]*pluginId:\s*['"]json['"][\s\S]*surfaceId:\s*['"]main['"][\s\S]*initialText:\s*text/, 'text workflow actions must support attaching JSON panel with initial text')
assert.match(files.defaultWorkflowProviders, /textAction\(['"]workflow\.open-json-surface['"],\s*['"]Open JSON Surface['"][\s\S]*kind:\s*['"]open-plugin-surface['"][\s\S]*pluginId:\s*['"]json['"][\s\S]*surfaceId:\s*['"]main['"]/,'text workflow actions must support opening JSON as a plugin surface')

console.log('workflow JSON panel story checks passed')
