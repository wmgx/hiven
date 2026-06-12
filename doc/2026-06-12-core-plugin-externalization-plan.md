# Core Plugin Externalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the remaining internal `src/workspace/corePlugin.ts` contributions into first-party external plugin packages under `src/plugins`, leaving framework code as plugin host primitives only.

**Architecture:** The framework may expose generic effects and host primitives, but it should not own product-facing commands or panels. First-party plugins contribute commands, panels, toolbar items, locales, and manifest versions; the host applies generic effects through `effectRunner`.

**Tech Stack:** Tauri + Vite + React + TypeScript, hiven plugin registry, first-party bundled plugins, Node verifier scripts.

---

## Current State

`src/workspace/corePlugin.ts` still owns these internal contributions:

- `core.toggle-sticky-scroll`
- `core.set-language`
- `core.regex-tester`
- `core.regex-tester` panel registration

`core-pane` is already externalized and now owns:

- `core-pane.show-main-panel`
- `core-pane.split`
- `core-pane.close`

Relevant existing verification:

```bash
npm run test:global-pinned-launcher
npm run check:architecture
git diff --check
npm run build
```

Before starting, check current worktree state. This repo may contain unrelated uncommitted quick-text/text-output work; do not stage or revert it.

```bash
git status --short --ignored
```

Expected: unrelated modified/untracked files may exist. Only stage files listed by each task.

---

## File Structure

Modify:

- `src/plugins/core-pane/index.ts`  
  Add pane-oriented commands currently owned by internal core: sticky scroll and language selection.

- `src/plugins/core-pane/locales/en.json`  
  Add English labels/descriptions/options for migrated pane commands.

- `src/plugins/core-pane/locales/zh.json`  
  Add Chinese labels/descriptions/options for migrated pane commands.

- `src/plugins/core-pane/manifest.json`  
  Bump plugin version after adding migrated commands.

- `src/builtin-plugins/index.json`  
  Bump builtin index version and `core-pane` version.

- `src/workspace/corePlugin.ts`  
  Remove migrated command definitions. After Task 1, it should only contain regex tester until Task 2 removes it too.

- `scripts/test-global-pinned-launcher.mjs` or a new `scripts/test-core-plugin-externalization.mjs`  
  Add regression assertions that internal `corePlugin` no longer owns migrated commands.

Create:

- `src/plugins/regex-tester/index.tsx`  
  New first-party plugin package for the regex tester command and panel.

- `src/plugins/regex-tester/manifest.json`

- `src/plugins/regex-tester/locales/en.json`

- `src/plugins/regex-tester/locales/zh.json`

Optionally delete after migration:

- `src/panels/CoreRegexPanel.tsx` if no imports remain.

Keep:

- `src/panels/RegexTesterPanel.tsx` may stay as a reusable UI component for now. If moved, do it in a separate cleanup after behavior is green.

---

## Task 1: Move Pane Commands Into `core-pane`

**Files:**
- Modify: `src/plugins/core-pane/index.ts`
- Modify: `src/plugins/core-pane/locales/en.json`
- Modify: `src/plugins/core-pane/locales/zh.json`
- Modify: `src/plugins/core-pane/manifest.json`
- Modify: `src/builtin-plugins/index.json`
- Modify: `src/workspace/corePlugin.ts`
- Modify or create: `scripts/test-core-plugin-externalization.mjs`

- [ ] **Step 1: Add failing verifier for command ownership**

Create `scripts/test-core-plugin-externalization.mjs` if it does not exist:

```js
#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const corePlugin = read('src/workspace/corePlugin.ts')
const corePanePlugin = read('src/plugins/core-pane/index.ts')
const corePaneManifest = JSON.parse(read('src/plugins/core-pane/manifest.json'))
const builtinIndex = JSON.parse(read('src/builtin-plugins/index.json'))
const corePaneEntry = builtinIndex.packages.find((entry) => entry.pluginId === 'core-pane')

assert.doesNotMatch(corePlugin, /core\.toggle-sticky-scroll/, 'sticky scroll command should not live in internal corePlugin')
assert.doesNotMatch(corePlugin, /core\.set-language/, 'set language command should not live in internal corePlugin')

assert.match(corePanePlugin, /id:\s*['"]core-pane\.toggle-sticky-scroll['"]/, 'core-pane should own sticky scroll command')
assert.match(corePanePlugin, /type:\s*['"]pane\.update['"][\s\S]*stickyScroll/, 'sticky scroll should remain a pane update effect')
assert.match(corePanePlugin, /id:\s*['"]core-pane\.set-language['"]/, 'core-pane should own set language command')
assert.match(corePanePlugin, /languageSource:\s*['"]manual['"]|languageSource:\s*['"]auto['"]/, 'set language should preserve languageSource behavior')

assert.equal(corePaneManifest.version, '1.2.0', 'core-pane manifest version should be bumped')
assert.equal(corePaneEntry?.version, '1.2.0', 'builtin index should publish bumped core-pane version')

console.log('core plugin externalization checks passed')
```

- [ ] **Step 2: Add npm script**

Modify `package.json` scripts:

```json
"test:core-plugin-externalization": "node scripts/test-core-plugin-externalization.mjs"
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm run test:core-plugin-externalization
```

Expected: FAIL because `core.toggle-sticky-scroll` and `core.set-language` still live in `src/workspace/corePlugin.ts`.

- [ ] **Step 4: Move sticky scroll command**

In `src/plugins/core-pane/index.ts`, add a command:

```ts
{
  id: 'core-pane.toggle-sticky-scroll',
  title: 'command.toggleStickyScroll.title',
  description: 'command.toggleStickyScroll.description',
  icon: 'panel-top',
  aliases: ['sticky-scroll', 'toggle-sticky-scroll'],
  live: { pinnable: false },
  inputs: [
    { key: 'target', label: 'input.target.label', kind: 'pane', required: true },
  ],
  inputResolution: { strategy: 'use-active', fallback: 'fail' },
  run(ctx) {
    const target = ctx.inputs.target as PaneInput | undefined
    if (!target?.paneId) return { effects: [] }
    const stickyScrollEnabled = target.stickyScroll === true
    return {
      effects: [
        {
          type: 'pane.update' as const,
          paneId: target.paneId,
          patch: { stickyScroll: !stickyScrollEnabled },
        },
        {
          type: 'status.message' as const,
          level: 'info' as const,
          message: stickyScrollEnabled
            ? 'Current pane sticky scroll disabled'
            : 'Current pane sticky scroll enabled',
        },
      ],
    }
  },
}
```

- [ ] **Step 5: Move set language command**

In `src/plugins/core-pane/index.ts`, add local language option constants near `SplitDirection`:

```ts
const LANGUAGE_OPTIONS = [
  { label: 'param.language.option.auto.label', value: 'auto' },
  { label: 'param.language.option.plaintext.label', value: 'plaintext' },
  { label: 'JSON', value: 'json' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'XML', value: 'xml' },
  { label: 'SQL', value: 'sql' },
  { label: 'Python', value: 'python' },
  { label: 'Shell', value: 'shell' },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'Java', value: 'java' },
  { label: 'C#', value: 'csharp' },
  { label: 'C++', value: 'cpp' },
]

const EDITOR_LANGUAGE_VALUES = new Set(LANGUAGE_OPTIONS.map((option) => option.value).filter((value) => value !== 'auto'))
```

Add the command:

```ts
{
  id: 'core-pane.set-language',
  title: 'command.setLanguage.title',
  description: 'command.setLanguage.description',
  icon: 'code-2',
  aliases: ['language', 'set-language'],
  live: { pinnable: false },
  inputs: [
    { key: 'target', label: 'input.target.label', kind: 'pane', required: true },
  ],
  inputResolution: { strategy: 'use-active', fallback: 'fail' },
  params: [
    {
      key: 'language',
      label: 'param.language.label',
      type: 'single-select',
      options: LANGUAGE_OPTIONS,
      default: 'auto',
      required: true,
    },
  ],
  run(ctx) {
    const target = ctx.inputs.target as PaneInput | undefined
    if (!target?.paneId) return { effects: [] }
    const requested = String(ctx.params.language ?? 'auto')
    if (requested === 'auto') {
      return {
        effects: [{
          type: 'pane.update' as const,
          paneId: target.paneId,
          patch: { detectedLanguage: undefined, languageSource: 'auto' as const },
        }],
      }
    }
    const language = EDITOR_LANGUAGE_VALUES.has(requested) ? requested : 'plaintext'
    return {
      effects: [{
        type: 'pane.update' as const,
        paneId: target.paneId,
        patch: { language, languageSource: 'manual' as const },
      }],
    }
  },
}
```

Note: This intentionally avoids importing `languageDetector` or `languageOptions` from workspace internals. `auto` restores host auto-language mode; paste/change detection can refresh `detectedLanguage` through existing editor lifecycle.

- [ ] **Step 6: Add locales**

Update `src/plugins/core-pane/locales/en.json`:

```json
{
  "command.toggleStickyScroll.title": "Toggle Sticky Scroll",
  "command.toggleStickyScroll.description": "Enable or disable sticky scroll in the active pane",
  "command.setLanguage.title": "Set Language",
  "command.setLanguage.description": "Set syntax language for the active pane",
  "input.target.label": "Pane",
  "param.language.label": "Language",
  "param.language.option.auto.label": "Auto Detect",
  "param.language.option.plaintext.label": "Plain Text"
}
```

Merge these keys into the existing JSON object; keep existing split/close keys.

Update `src/plugins/core-pane/locales/zh.json`:

```json
{
  "command.toggleStickyScroll.title": "切换层级吸顶",
  "command.toggleStickyScroll.description": "开启或关闭当前面板的层级吸顶",
  "command.setLanguage.title": "设置语言",
  "command.setLanguage.description": "设置当前面板的语法语言",
  "input.target.label": "面板",
  "param.language.label": "语言",
  "param.language.option.auto.label": "自动识别",
  "param.language.option.plaintext.label": "纯文本"
}
```

Merge these keys into the existing JSON object.

- [ ] **Step 7: Remove migrated commands from internal core**

Delete the `core.toggle-sticky-scroll` and `core.set-language` command objects from `src/workspace/corePlugin.ts`.

Remove unused imports if present:

```ts
import type { PaneInput } from './pluginTypes'
import { LANGUAGE_COMMAND_OPTIONS, isEditorLanguage } from './languageOptions'
import { detectEditorLanguage } from './languageDetector'
import { useAppStore } from '../store'
```

Do not remove regex tester in this task.

- [ ] **Step 8: Bump core-pane version**

Update `src/plugins/core-pane/manifest.json`:

```json
"version": "1.2.0"
```

Update `src/builtin-plugins/index.json`:

```json
"version": 9
```

and:

```json
{
  "pluginId": "core-pane",
  "dir": "core-pane",
  "version": "1.2.0"
}
```

- [ ] **Step 9: Verify GREEN**

Run:

```bash
npm run test:core-plugin-externalization
npm run test:global-pinned-launcher
npm run check:architecture
git diff --check
npm run build
```

Expected:

- externalization checks passed
- global pinned launcher checks passed
- architecture boundary check passed
- build succeeds, existing large chunk warning is acceptable

- [ ] **Step 10: Commit only Task 1 files**

Run:

```bash
git add package.json scripts/test-core-plugin-externalization.mjs src/plugins/core-pane/index.ts src/plugins/core-pane/locales/en.json src/plugins/core-pane/locales/zh.json src/plugins/core-pane/manifest.json src/builtin-plugins/index.json src/workspace/corePlugin.ts
git commit -m "refactor: move core pane commands to core-pane plugin"
```

---

## Task 2: Move Regex Tester Into A First-Party Plugin

**Files:**
- Create: `src/plugins/regex-tester/index.tsx`
- Create: `src/plugins/regex-tester/manifest.json`
- Create: `src/plugins/regex-tester/locales/en.json`
- Create: `src/plugins/regex-tester/locales/zh.json`
- Modify: `src/workspace/corePlugin.ts`
- Modify: `src/builtin-plugins/index.json`
- Modify: `scripts/test-core-plugin-externalization.mjs`

- [ ] **Step 1: Extend failing verifier**

Add to `scripts/test-core-plugin-externalization.mjs`:

```js
const regexPlugin = read('src/plugins/regex-tester/index.tsx')
const regexManifest = JSON.parse(read('src/plugins/regex-tester/manifest.json'))
const regexEntry = builtinIndex.packages.find((entry) => entry.pluginId === 'regex-tester')

assert.doesNotMatch(corePlugin, /core\.regex-tester/, 'regex tester command should not live in internal corePlugin')
assert.doesNotMatch(corePlugin, /CoreRegexPanel/, 'regex tester panel should not be registered by internal corePlugin')
assert.match(regexPlugin, /id:\s*['"]regex-tester\.open['"]/, 'regex tester plugin should provide open command')
assert.match(regexPlugin, /id:\s*['"]regex-tester\.panel['"]/, 'regex tester plugin should provide panel contribution')
assert.equal(regexManifest.version, '1.0.0', 'regex tester plugin starts at version 1.0.0')
assert.equal(regexEntry?.version, '1.0.0', 'builtin index should publish regex tester plugin')
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test:core-plugin-externalization
```

Expected: FAIL because `src/plugins/regex-tester` does not exist yet and `core.regex-tester` still lives in `src/workspace/corePlugin.ts`.

- [ ] **Step 3: Create regex tester manifest**

Create `src/plugins/regex-tester/manifest.json`:

```json
{
  "pluginId": "regex-tester",
  "displayName": "Regex Tester",
  "displayNameI18n": { "zh": "正则测试器" },
  "version": "1.0.0",
  "capabilities": ["command", "panel"]
}
```

- [ ] **Step 4: Create regex tester locales**

Create `src/plugins/regex-tester/locales/en.json`:

```json
{
  "command.open.title": "Regex Tester",
  "command.open.description": "Open regex tester panel",
  "panel.main.title": "Regex Tester"
}
```

Create `src/plugins/regex-tester/locales/zh.json`:

```json
{
  "command.open.title": "正则测试器",
  "command.open.description": "打开正则测试面板",
  "panel.main.title": "正则测试器"
}
```

- [ ] **Step 5: Create plugin entry**

Create `src/plugins/regex-tester/index.tsx`:

```tsx
import { definePlugin, useT, type PanelPropsV2 } from '@hiven/plugin'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { RegexTesterPanel } from '../../panels/RegexTesterPanel'

function RegexTesterPluginPanel({ panelId, host }: PanelPropsV2<unknown>) {
  const activePaneId = useWorkspaceStore((state) => state.activePaneId)
  const t = useT('regex-tester')
  return (
    <RegexTesterPanel
      instanceId={panelId}
      title={t('panel.main.title')}
      placement="bottom"
      props={{}}
      activePaneId={activePaneId}
      onClose={host.close}
    />
  )
}

export const regexTesterPlugin = definePlugin({
  commands: [
    {
      id: 'regex-tester.open',
      title: 'command.open.title',
      description: 'command.open.description',
      icon: 'regex',
      aliases: ['regex', 'regexp', '正则'],
      live: { pinnable: false },
      run() {
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: 'regex-tester.panel',
            placement: 'bottom' as const,
            ownerPluginId: 'regex-tester',
          }],
        }
      },
    },
  ],
  panels: [
    {
      id: 'regex-tester.panel',
      title: 'panel.main.title',
      defaultPlacement: 'bottom',
      component: RegexTesterPluginPanel,
    },
  ],
})

export default regexTesterPlugin
```

This still imports `useWorkspaceStore` and `RegexTesterPanel` from workspace paths. That is acceptable as an intermediate first-party bundled plugin migration because it removes product command/panel ownership from `corePlugin`. A later SDK hardening task can expose active pane hooks through `@hiven/plugin` and move the UI component fully under `src/plugins/regex-tester`.

- [ ] **Step 6: Remove regex tester from internal core**

In `src/workspace/corePlugin.ts`, remove:

- `CoreRegexPanel` import
- `core.regex-tester` command
- `panels` array containing `core.regex-tester`

After this step, if `corePlugin` has no commands, delete the module and remove `import './workspace/corePlugin'` from `src/App.tsx`. If `definePlugin` rejects an empty definition, do not leave an empty `definePlugin({})`.

- [ ] **Step 7: Add regex tester to builtin index**

Update `src/builtin-plugins/index.json`:

```json
"version": 10
```

Add package entry:

```json
{
  "pluginId": "regex-tester",
  "dir": "regex-tester",
  "version": "1.0.0"
}
```

Place it near other tool plugins; exact sort order is less important than stable JSON formatting.

- [ ] **Step 8: Verify GREEN**

Run:

```bash
npm run test:core-plugin-externalization
npm run check:architecture
git diff --check
npm run build
```

Expected:

- internal `corePlugin` no longer owns regex tester
- build succeeds
- architecture check still passes

- [ ] **Step 9: Commit only Task 2 files**

Run:

```bash
git add scripts/test-core-plugin-externalization.mjs src/plugins/regex-tester src/workspace/corePlugin.ts src/builtin-plugins/index.json src/App.tsx
git commit -m "refactor: move regex tester to first-party plugin"
```

If `src/workspace/corePlugin.ts` becomes unused and is deleted, include:

```bash
git add -u src/workspace/corePlugin.ts src/App.tsx
```

---

## Task 3: Final Guardrail And Cleanup

**Files:**
- Modify: `scripts/test-core-plugin-externalization.mjs`
- Modify: `package.json` if the test script was not added in Task 1
- Optional delete: `src/panels/CoreRegexPanel.tsx`

- [ ] **Step 1: Add final guardrail**

Append to `scripts/test-core-plugin-externalization.mjs`:

```js
assert.doesNotMatch(corePlugin, /definePlugin\(\{\s*commands:/, 'internal corePlugin should not register user-facing commands')
assert.doesNotMatch(corePlugin, /registerProductionPlugin\(\s*['"]core['"]/, 'internal corePlugin should not register a production plugin')
```

If `src/workspace/corePlugin.ts` was deleted in Task 2, change the script to treat missing file as success:

```js
function readOptional(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}
```

and read core plugin with:

```js
const corePlugin = readOptional('src/workspace/corePlugin.ts')
```

- [ ] **Step 2: Remove `CoreRegexPanel` wrapper if unused**

Check:

```bash
rg "CoreRegexPanel|corePlugin" src
```

If `src/panels/CoreRegexPanel.tsx` has no imports, delete it:

```bash
git rm src/panels/CoreRegexPanel.tsx
```

- [ ] **Step 3: Full verification**

Run:

```bash
npm run test:core-plugin-externalization
npm run test:global-pinned-launcher
npm run check:architecture
git diff --check
npm run build
git status --short --ignored
```

Expected:

- all listed checks pass
- status contains only intended files plus pre-existing unrelated worktree noise

- [ ] **Step 4: Commit cleanup**

Run:

```bash
git add scripts/test-core-plugin-externalization.mjs package.json
git add -u src/panels/CoreRegexPanel.tsx
git commit -m "test: guard core plugin externalization"
```

If there is nothing new to commit after Task 2, skip this commit and state that the guardrail was already committed.

---

## Acceptance Criteria

- `src/workspace/corePlugin.ts` no longer registers production plugin commands or panels.
- User-facing core capabilities are first-party plugin contributions under `src/plugins/*`.
- `core-pane` owns pane-related commands.
- `regex-tester` owns regex tester command and panel.
- Builtin plugin versions are bumped in both package manifests and `src/builtin-plugins/index.json`.
- Existing global launcher main panel command still works via `core-pane.show-main-panel`.
- Verification passes:

```bash
npm run test:core-plugin-externalization
npm run test:global-pinned-launcher
npm run check:architecture
git diff --check
npm run build
```

## Residual Risks

- `regex-tester` may initially import workspace internals because the current plugin SDK does not expose all hooks needed by the panel. That is acceptable for a first-party bundled migration, but should be noted as follow-up SDK hardening.
- `core-pane.set-language` should avoid importing workspace language detector internals. Returning to auto language mode through `languageSource: 'auto'` is the conservative external plugin behavior.
- Do not mix this migration with the currently unrelated quick-text/text-output changes in the worktree.

