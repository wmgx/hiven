#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  refactorSuite: read('scripts/test-refactor-suite.mjs'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  workflowIndex: read('src/workflow/index.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:workflow-chat-reply-story'],
  'node scripts/test-workflow-chat-reply-story.mjs',
  'package.json must expose test:workflow-chat-reply-story',
)
assert.match(
  files.refactorSuite,
  /test:workflow-chat-reply-story/,
  'refactor suite must include chat reply workflow story coverage',
)
assert.match(
  files.defaultWorkflowProviders,
  /function\s+draftPoliteReply\(text:\s*string\):\s*string[\s\S]*谢谢|Thanks|Thank you/,
  'workflow must provide a local deterministic polite reply draft helper',
)
assert.match(
  files.defaultWorkflowProviders,
  /function\s+extractTodoDraft\(text:\s*string\):\s*string[\s\S]*TODO|待办|Action items/,
  'workflow must provide a local deterministic todo extraction helper',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.draft-polite-reply['"],\s*['"]Draft Polite Reply['"][\s\S]*routeTextOutput\(draftPoliteReply\(text\),[\s\S]*kind:\s*['"]paste-to-foreground-app['"]/,
  'text workflow actions must support drafting a polite reply and pasting it to the foreground app',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.open-reply-draft-in-editor['"],\s*['"]Open Reply Draft in Editor['"][\s\S]*routeTextOutput\(draftPoliteReply\(text\),[\s\S]*kind:\s*['"]open-in-editor['"][\s\S]*title:\s*['"]Reply Draft['"]/,
  'text workflow actions must support sending a complex reply draft to the editor',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.extract-todos['"],\s*['"]Extract Todos['"][\s\S]*routeTextOutput\(extractTodoDraft\(text\),[\s\S]*kind:\s*['"]open-in-editor['"][\s\S]*title:\s*['"]Extracted Todos['"]/,
  'text workflow actions must support organizing selected chat text into todos in the editor',
)
assert.match(
  files.workflowIndex,
  /draftPoliteReply[\s\S]*extractTodoDraft|extractTodoDraft[\s\S]*draftPoliteReply/,
  'workflow index must export chat story helpers for focused verification',
)

console.log('workflow chat reply story checks passed')
