# Launcher System Design and Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or equivalent task-by-task execution. Do not make opportunistic launcher fixes outside this plan. Keep commits small and verify each task before moving on.

**Goal:** Redesign the launcher around a shared `LauncherItem` domain model so CommandPalette and GlobalLauncher share identity, ranking, usage, execution lifecycle, plugin API boundaries, result output, and dynamic suggestions.

**Architecture:** Launcher is a host/workspace domain, not a pair of React components. Plugins contribute launcher items through a public API; the host converts them into system-owned identities, ranks them per system surface, records usage at selection time, and runs each item through a controlled execution context. Command execution, pinned access, dynamic suggestions, and result choices are all modeled as launcher flows without leaking workspace internals into plugins.

**Tech Stack:** React, Zustand store, Tauri window bridge, existing plugin registry, existing effect runner/host APIs where appropriate.

---

## Current Problems

- CommandPalette and GlobalLauncher still contain too much local launcher logic.
- Search/ranking logic was partially shared, but item identity and usage identity remain scattered.
- Usage source is easy to put in the executor by mistake; it must be a launcher selection concern.
- `quick-entry` has a two-step lifecycle and is easy to mishandle as a normal command.
- Plugin settings and launcher execution have leaked workspace internals in places.
- Text command output currently lacks a clear result model: some commands should show output, some should copy, some should replace active text.
- `instant suggestion` exists as a separate path instead of being part of the launcher model.

## Core Decisions

### 1. Launcher Is Centered On `LauncherItem`

Launcher should not be command-centered. A command is only one possible implementation detail behind a user-selectable launcher item.

Every launcher item has:

```ts
type LauncherItem = {
  systemKey: SystemLauncherItemKey
  contribution: LauncherItemContribution
  pluginId?: string
  display: LauncherItemDisplay
  behavior: LauncherBehavior
  execute: LauncherExecuteHandler
}
```

Do not expose `systemKey` or usage keys to plugins. The host generates identity.

### 2. Behavior Types Are Lifecycle Types

Do not model every product feature as a different launcher kind. Keep behavior types small:

```ts
type LauncherBehavior =
  | { type: 'perform' }
  | { type: 'collect-input'; input: LauncherInputSpec }
```

`perform` covers direct actions.  
`collect-input` covers two-step actions such as web quick open.

Dynamic items use the same model but do not participate in long-term usage or pinning in the first version.

### 3. System Surfaces

Only two system launcher surfaces exist in the first version:

```ts
type LauncherSurfaceId = 'command-palette' | 'global-launcher'
```

`pinned` is not a surface. It is a shortcut/reference mechanism.

Plugin items may optionally restrict where they appear:

```ts
surfaces?: LauncherSurfaceId[]
```

Rules:

- Missing `surfaces` means the item appears in both main surfaces.
- Plugins cannot define custom surfaces.
- Runtime validation must reject unknown surface values.
- Result choices cannot declare surfaces.

### 4. Usage Is Selection Intent

Usage recording happens only at the launcher selection layer.

```ts
recordLauncherSelection(surfaceId, systemLauncherItemKey)
```

Rules:

- Record when the user selects a first-level launcher item.
- For `perform`, record before execution.
- For `collect-input`, record when entering input mode, not after successful submit.
- Executor functions must not write usage by default.
- Pinned execution does not write usage.
- Dynamic items do not write long-term usage in the first version.
- Execution success/failure does not change usage; usage measures intent.

### 5. Usage Identity Is System Generated And Item-Scoped

Plugins cannot customize usage keys.

System key examples:

```ts
plugin:${pluginId}:launcher:${itemId}
host:view:${viewId}
host:action:${actionId}
```

Rules:

- Usage is launcher item scoped, not command scoped.
- If one command has two launcher items, they are ranked separately.
- Do not include plugin version in usage keys.
- Do not include dev/source in usage keys.
- If a plugin changes an item semantic meaning, it must change the item id.

### 6. Ranking Is Mixed, Not Grouped

There is no "Common Features" group.

Use one ranked list:

```text
score = matchScore + usageScore(surfaceId) + pinnedBoost + hostStaticPriority
```

Rules:

- Match relevance must dominate.
- Usage is per surface.
- Pinned is only a mild boost, never absolute top placement.
- Plugins cannot set static priority.
- Host may use static priority for a small number of host-owned items.
- Query-empty mode and query-present mode use the same scoring pipeline with different weights.

Recommended usage record:

```ts
type LauncherUsageRecord = {
  count: number
  lastSelectedAt: number
}
```

Do not keep using only `recentActionNames` plus `actionUsageCounts` for the new model.

### 7. Pinned Is A Reference, Not Training Data

Pinned entries reference launcher items:

```ts
type PinnedLauncherRef = {
  itemKey: SystemLauncherItemKey
}
```

Rules:

- Pinned execution does not update launcher usage.
- Pinned contributes only a mild ranking boost when the referenced item appears in launcher search.
- Pinned does not duplicate item display/execution data.
- If the referenced plugin/item disappears, keep the dangling ref and show it as unavailable with a remove action.

### 8. Plugins Contribute Launcher Items Directly

Do not keep launcher as an automatic view over `commands`.

Plugin API should move to:

```ts
type PluginDefinition = {
  launcher?: {
    items?: LauncherItemContribution[]
    dynamicItems?: LauncherDynamicItemProvider
  }
  settings?: PluginSettingsContribution
  commands?: Record<string, CommandContribution>
}
```

Rules:

- CommandPalette and GlobalLauncher search only `launcher.items` plus host-owned launcher items.
- `commands` remain for non-launcher execution paths and future workflows.
- Do not provide `ctx.api.runCommand`.
- Do not support command references in launcher item first version.
- If a plugin wants to reuse command logic, it should share a local function inside the plugin.
- Cross-capability orchestration belongs to a future workflow system, not launcher API.

### 8.1 Prefer Tool-First Plugin API

To reduce plugin implementation cost across launcher, panel, settings, and pinned entry points, introduce a tool-first layer. Most plugins should define `tools`; host adapters turn tools into launcher items, panel actions, and pinnable targets.

```ts
type PluginToolContribution<TSettings = unknown> = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  icon?: IconRef
  inputPolicy?: TextInputPolicy
  run(ctx: PluginToolContext<TSettings>): Promise<PluginToolResult>
  surfaces?: PluginToolSurfaces
}

type PluginToolSurfaces = {
  launcher?: boolean | ToolLauncherOptions
  panel?: boolean | ToolPanelOptions
  pinnable?: boolean
}
```

Default tool shape:

```ts
tools: [
  {
    id: 'reverse',
    title: 'Reverse',
    inputPolicy: { mode: 'auto' },
    async run(ctx) {
      return ctx.output.text(reverse(ctx.input.text))
    },
    surfaces: {
      launcher: true,
      panel: true,
      pinnable: true,
    },
  },
]
```

Rules:

- `PluginTool` is the preferred authoring API.
- Launcher and panel still keep separate host models internally.
- Host adapters generate `LauncherItem` and `PanelAction` from a tool.
- Usage is still launcher item scoped and recorded only on launcher selection.
- Panel action execution still does not affect launcher usage.
- Pinned references the generated host target, not a raw function.
- Advanced plugins may still define explicit `launcher.items` or `panel.actions` when the generated adapter is not expressive enough.
- Explicit launcher/panel definitions should share pure local functions with tools instead of calling commands.
- Do not provide `ctx.api.runCommand`.

Recommended plugin definition shape:

```ts
type PluginDefinition = {
  tools?: PluginToolContribution[]
  launcher?: {
    items?: LauncherItemContribution[]
    dynamicItems?: LauncherDynamicItemProvider
  }
  panel?: {
    actions?: PanelActionContribution[]
  }
  settings?: PluginSettingsContribution
  commands?: Record<string, CommandContribution>
}
```

Interpretation:

- Use `tools` for common user-facing capabilities.
- Use `launcher.items` for custom launcher lifecycle/output UX.
- Use `panel.actions` for custom panel-only UI behavior.
- Keep `commands` for non-UI execution and future workflow compatibility; commands do not automatically appear in launcher.

### 9. Plugin Execute Context Is Controlled

Plugins can define:

```ts
type LauncherExecuteHandler<TSettings = unknown> = (
  ctx: LauncherExecutionContext<TSettings>
) => Promise<LauncherExecuteResult>
```

Context:

```ts
type LauncherExecutionContext<TSettings = unknown> = {
  input?: { text: string }
  settings: TSettings
  locale: Locale
  api: PluginLauncherApi
}
```

Plugin API first version:

```ts
type PluginLauncherApi = {
  getActiveText(): string
  getSelectionText(): string
  getClipboardText(): Promise<string>
  replaceActiveText(text: string): Promise<void>
  insertText(text: string): Promise<void>
  copyText(text: string): Promise<void>
  openUrl(url: string): Promise<void>
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}
```

Rules:

- Plugins can only access their own settings through `ctx.settings`.
- Plugins cannot import workspace stores, effect runner, i18n registry, Monaco utilities, or other host internals.
- Plugins cannot read other plugin settings.
- Do not expose `surfaceId` to plugins in the first version.
- Host-owned launcher items may use internal host APIs, but plugin items cannot.

### 10. Output Is Result Choices

Execution result:

```ts
type LauncherExecuteResult =
  | { ok: true; output?: LauncherOutput }
  | { ok: false; message: string }

type LauncherOutput = {
  choices: LauncherResultChoice[]
}

type LauncherResultChoice = {
  id: string
  title: string
  subtitle?: string
  preview?: string
  primaryAction: LauncherResultActionHandler
  secondaryActions?: LauncherResultAction[]
}
```

Text output is represented as one result choice.

Default text output behavior:

- Display the output in launcher.
- The default Enter action copies the text.
- A plugin can return a choice whose primary action replaces active text, inserts text, opens URL, or returns another output.

Rules:

- If execution succeeds with no output, close launcher.
- If execution succeeds with output, keep launcher open and enter result choice mode.
- If execution fails, keep launcher open and show the error.
- Result choices can return more output choices, enabling multi-level flows.
- Escape returns to the previous flow frame; repeated Escape closes.

### 11. Single Result Behavior

"Only one result goes on screen" means Enter should directly use the only selectable result. It must not auto-execute while the query changes.

Rules:

- If the first-level filtered item list has one item, Enter selects that item.
- If result choice mode has one choice, Enter executes that choice's primary action.
- Do not auto-run a first-level item just because the list length becomes one.

### 12. Dynamic Items Replace Instant Suggestions

Keep instant suggestion capability, but rebuild it as dynamic launcher items:

```ts
type LauncherDynamicItemProvider = (
  ctx: LauncherDynamicContext
) => Promise<LauncherItemContribution[]>

type LauncherDynamicContext = {
  query: string
  locale: Locale
  settings: unknown
}
```

Rules:

- Query-empty mode does not call dynamic providers.
- Skip dynamic providers when query is too long, for example over 500 characters.
- Providers are isolated by timeout and error handling.
- Dynamic items use the same display/behavior/execute model.
- First version should not allow dynamic items to be pinned.
- First version should not write dynamic items to long-term usage.
- Dynamic items may return output choices.

### 13. Plugin Directory Convention

Use plugin-local structure:

```text
src/plugins/<plugin-id>/
  index.ts
  launcher/
    items.ts
  settings/
    model.ts
    SettingsBody.tsx
  shared/
    *.ts
```

Rules:

- Settings UI belongs inside the plugin.
- Settings model/defaults should be shared by launcher item code and settings UI.
- Host injects `value`, `onChange`, plugin-scoped `t`, and `locale` into settings body.
- Launcher execution reads current plugin settings from `ctx.settings`.

## Proposed File Structure

Create:

```text
src/workspace/launcher/types.ts
src/workspace/launcher/identity.ts
src/workspace/launcher/usage.ts
src/workspace/launcher/ranking.ts
src/workspace/launcher/registry.ts
src/workspace/launcher/controller.ts
src/workspace/launcher/output.ts
src/workspace/launcher/pluginApi.ts
```

Responsibilities:

- `types.ts`: shared launcher domain types.
- `identity.ts`: system identity generation and validation.
- `usage.ts`: surface-scoped usage storage helpers and migration helpers.
- `ranking.ts`: match/usage/pinned/static mixed scoring.
- `registry.ts`: collect host items, plugin static items, and plugin dynamic items.
- `controller.ts`: selection lifecycle, collect-input mode, result choice stack, Enter/Escape behavior.
- `output.ts`: helpers for text output as result choice and default copy action.
- `pluginApi.ts`: controlled API implementation passed to plugin launcher execute handlers.

Modify:

```text
src/store.ts
src/components/CommandPalette.tsx
src/components/GlobalLauncher.tsx
src/workspace/pluginTypes.ts
src/plugin-sdk.ts
src/workspace/pluginRegistry.ts
src/plugins/web-open/*
src/plugins/*/index.tsx
scripts/test-global-pinned-launcher.mjs
scripts/test-global-launcher-quick-text.mjs
scripts/test-plugin-text-output-contract.mjs
```

Delete or deprecate:

```text
launcherQuickEntries
InstantSuggestionProvider old path
CommandPalette direct command search
GlobalLauncher local LauncherItem model
GlobalLauncher local quick-entry item shape
legacy recentActionNames/actionUsageCounts after migration
```

## Implementation Tasks

### Task 1: Add Launcher Domain Types

**Files:**

- Create `src/workspace/launcher/types.ts`
- Modify `src/workspace/pluginTypes.ts`
- Modify `src/plugin-sdk.ts`

**Steps:**

- [ ] Define `LauncherSurfaceId = 'command-palette' | 'global-launcher'`.
- [ ] Define `LauncherItemContribution`, `LauncherBehavior`, `LauncherExecutionContext`, `LauncherExecuteResult`, `LauncherOutput`, `LauncherResultChoice`.
- [ ] Define `PluginLauncherApi` without `runCommand`.
- [ ] Export launcher public types from `src/plugin-sdk.ts`.
- [ ] Ensure plugin contributions cannot expose `usageKey`, `staticPriority`, custom surface strings, or command references.

**Acceptance:**

- TypeScript rejects `surfaces: ['unknown']`.
- TypeScript rejects `usageKey` on plugin launcher items.
- `@hiven/plugin` exports the new launcher types.

### Task 2: Add System Identity

**Files:**

- Create `src/workspace/launcher/identity.ts`

**Steps:**

- [ ] Implement `getPluginLauncherItemKey(pluginId, itemId)`.
- [ ] Implement host item key helpers, for example `getHostViewItemKey(viewId)`.
- [ ] Implement runtime validation for plugin item ids and surfaces.
- [ ] Add tests or script assertions for stable keys.

**Acceptance:**

- Same plugin id and item id always produce the same key.
- Key does not include plugin version or dev/source.
- Duplicate launcher item ids inside a plugin are rejected or reported.

### Task 3: Replace Usage Model

**Files:**

- Modify `src/store.ts`
- Create `src/workspace/launcher/usage.ts`

**Steps:**

- [ ] Replace top-level action usage with `launcherUsageBySurface`.
- [ ] Store records as `{ count, lastSelectedAt }`.
- [ ] Implement `recordLauncherSelection(surfaceId, itemKey)`.
- [ ] Migrate legacy `recentActionNames/actionUsageCounts` into `command-palette` if needed.
- [ ] Do not record usage from command executor.

**Acceptance:**

- CommandPalette and GlobalLauncher can have different usage scores for the same item key.
- Pinned execution does not change usage records.
- Dynamic item execution does not change long-term usage records.

### Task 4: Add Mixed Ranking

**Files:**

- Create or replace `src/workspace/launcher/ranking.ts`
- Reuse existing pinyin/acronym matching from `src/workspace/searchRanking.ts` or move it cleanly.

**Steps:**

- [ ] Implement one scoring function for both surfaces.
- [ ] Include match score, usage score, pinned boost, and host static priority.
- [ ] Ensure plugins cannot provide static priority.
- [ ] Make pinned boost mild, not absolute.

**Acceptance:**

- Strong query match beats high-usage weak match.
- Query-empty ordering is influenced by usage and pinned boost.
- No category/group rendering is required for ranking.

### Task 5: Add Launcher Registry

**Files:**

- Create `src/workspace/launcher/registry.ts`
- Modify `src/workspace/pluginRegistry.ts`

**Steps:**

- [ ] Collect static plugin launcher items.
- [ ] Collect host-owned launcher items.
- [ ] Filter plugin items by system surface.
- [ ] Add dynamic item provider support with query guards and error isolation.
- [ ] Remove command auto-discovery from launcher candidates.

**Acceptance:**

- A command does not appear in either launcher unless a launcher item exists.
- Plugin item appears in both surfaces by default.
- Plugin item with `surfaces: ['global-launcher']` does not appear in CommandPalette.
- Dynamic provider errors do not break the launcher.

### Task 6: Add Launcher Controller

**Files:**

- Create `src/workspace/launcher/controller.ts`
- Create `src/workspace/launcher/output.ts`
- Create `src/workspace/launcher/pluginApi.ts`

**Steps:**

- [ ] Implement first-level selection.
- [ ] Implement collect-input flow.
- [ ] Record usage at first-level selection time.
- [ ] Implement result choice stack.
- [ ] Implement default text output as one result choice with copy primary action.
- [ ] Implement Escape back behavior.
- [ ] Implement single-result Enter behavior.

**Acceptance:**

- `perform` records usage then executes.
- `collect-input` records usage when entering input mode.
- Successful no-output action closes launcher.
- Successful output action enters result mode.
- Failed action leaves launcher open with error.
- Text output defaults to Enter-copy.

### Task 7: Migrate CommandPalette

**Files:**

- Modify `src/components/CommandPalette.tsx`

**Steps:**

- [ ] Replace local palette item model with shared launcher controller/model.
- [ ] Stop reading commands directly.
- [ ] Use `surfaceId = 'command-palette'`.
- [ ] Use shared ranking and usage.
- [ ] Render result choices and collect-input mode.

**Acceptance:**

- CommandPalette shows only launcher items and dynamic items.
- Usage in CommandPalette does not affect GlobalLauncher.
- Result output behavior matches GlobalLauncher.

### Task 8: Migrate GlobalLauncher

**Files:**

- Modify `src/components/GlobalLauncher.tsx`
- Modify Tauri event handling only if required for no-output execution.

**Steps:**

- [ ] Replace local GlobalLauncher item model with shared launcher controller/model.
- [ ] Use `surfaceId = 'global-launcher'`.
- [ ] Remove category section assumptions permanently.
- [ ] Ensure standalone window records selection locally before any bridge execution.
- [ ] Keep existing native fix: if launcher is already visible, focus without compact resize.

**Acceptance:**

- GlobalLauncher and CommandPalette use the same item identity and ranking code.
- Quick-entry usage cannot be unreachable.
- Standalone launcher usage is attributed to `global-launcher`.
- Repeated double Command does not shrink the launcher.

### Task 9: Migrate Web Open Plugin

**Files:**

- Modify `src/plugins/web-open/index.tsx`
- Create or update `src/plugins/web-open/launcher/items.ts`
- Keep/update `src/plugins/web-open/settings/model.ts`
- Keep/update `src/plugins/web-open/settings/SettingsBody.tsx`

**Steps:**

- [ ] Convert web quick open entries into plugin launcher items.
- [ ] Use `collect-input` for query entry.
- [ ] Read configuration from `ctx.settings`.
- [ ] Open URLs via `ctx.api.openUrl`.
- [ ] Remove direct imports from workspace stores/i18n/effect internals.

**Acceptance:**

- Web open works from CommandPalette and GlobalLauncher.
- Web open settings UI remains plugin-local.
- No `src/plugins/web-open/**` file imports `src/workspace/**` except through public plugin SDK aliases/types.

### Task 10: Migrate Text Tools Such As Reverse

**Files:**

- Modify relevant plugin files for line/text tools.
- Modify tests/scripts for text output behavior.

**Steps:**

- [ ] Expose reverse as a launcher item.
- [ ] Its execute handler reads active/selected text through `ctx.api`.
- [ ] It returns text output as result choice or directly provides replace/copy actions.
- [ ] Default text output Enter copies.
- [ ] If the desired UX is "replace active text", expose that as the primary action explicitly.

**Acceptance:**

- Reverse is usable from launcher.
- Output is visible.
- Enter action is deterministic and tested.
- No generic `PluginCommandResult.output` is blindly converted to `text.replace` without launcher output policy.

### Task 11: Rebuild Dynamic Items

**Files:**

- Modify plugins that currently use instant suggestions.
- Remove old instant suggestion APIs after migration.

**Steps:**

- [ ] Add `dynamicItems(ctx)` support to plugin launcher API.
- [ ] Convert existing instant suggestions to dynamic items.
- [ ] Enforce no pin and no long-term usage for dynamic items.
- [ ] Add timeout/error isolation.

**Acceptance:**

- Dynamic suggestions appear only when query is non-empty.
- Provider failure does not break launcher rendering.
- Dynamic item can execute and return output choices.

### Task 12: Clean Up Old Paths

**Files:**

- Search all `src/**`

**Steps:**

- [ ] Remove old `launcherQuickEntries` API.
- [ ] Remove old `InstantSuggestionProvider` launcher path.
- [ ] Remove command auto-search from both launchers.
- [ ] Remove executor usage recording.
- [ ] Remove duplicated launcher item identity/scoring helpers from React components.

**Acceptance:**

- `rg "launcherQuickEntries|InstantSuggestionProvider|recentActionNames|actionUsageCounts"` shows only migration/test references or no references.
- `runPluginCommandById` has no usage recording side effect.

## Required Verification

Run:

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

Add or update focused scripts/tests:

```bash
npm run test:global-pinned-launcher
npm run test:global-launcher-quick-text
npm run test:plugin-text-output-contract
```

Expected behavior checks:

- CommandPalette and GlobalLauncher rank differently after separate usage histories.
- Search exact/prefix match beats high usage weak matches.
- Pinned affects ranking mildly but does not create a group or absolute top position.
- Pinned click does not mutate usage.
- Web open uses `ctx.settings` and `ctx.api.openUrl`.
- Reverse produces visible output and deterministic Enter behavior.
- Dynamic item errors are isolated.
- Launcher already open plus double Command only focuses; it does not shrink.

## Non-Goals For This Pass

- No workflow system.
- No command references from launcher items.
- No `ctx.api.runCommand`.
- No plugin-defined usage keys.
- No plugin-defined static priority.
- No plugin-defined surfaces beyond the host enum.
- No multi-field launcher forms.
- No long-term usage for dynamic items.
- No pinned usage training data.

## Panel Actions And Text Input Policy

Launcher only owns searchable entry selection. Panel commands/actions are a separate surface and must not be forced through launcher.

Panel action examples:

- A renderer toolbar button.
- A panel-local refresh/copy/format/switch-mode action.
- A plugin-owned action that operates on the current panel content.

Do not auto-register panel actions as launcher items. If the same product capability needs both a launcher entry and a panel button, the plugin should share a local pure function and expose two separate entry points:

```ts
async function transformText(text: string, options: TransformOptions): Promise<string> {
  return text
}

export const launcherItem = {
  id: 'reverse-active-text',
  async execute(ctx) {
    const text = ctx.api.getSelectionText() || ctx.api.getActiveText()
    const output = await transformText(text, {})
    return textResultChoice(output)
  },
}

export const panelAction = {
  id: 'reverse-panel-selection',
  async run(ctx) {
    const text = ctx.input.text
    const output = await transformText(text, {})
    await ctx.api.replaceInputText(output, ctx.input.range)
    return { ok: true }
  },
}
```

### Panel Action Model

Panel actions should have their own model:

```ts
type PanelActionContribution = {
  id: string
  title: string
  icon?: IconRef
  inputPolicy?: PanelInputPolicy
  run(ctx: PanelActionContext): Promise<PanelActionResult>
}
```

Panel action context:

```ts
type PanelActionContext<TSettings = unknown> = {
  panelId: string
  paneId?: string
  settings: TSettings
  locale: Locale
  input: ResolvedPanelInput
  api: PanelActionApi
}
```

Rules:

- Panel action usage does not affect launcher ranking.
- Panel action execution does not write launcher usage.
- Panel action cannot call arbitrary plugin commands.
- Panel action cannot import workspace stores or renderer internals.
- Panel action can only access its own plugin settings.

### Text Input Policy

Both launcher items and panel actions need a consistent input resolution mechanism. Do not make each plugin guess whether to use selection text or whole text.

Use three text input modes:

```ts
type TextInputMode =
  | 'auto'
  | 'all'
  | 'selection'

type TextInputPolicy = {
  mode?: TextInputMode
}
```

Resolved input:

```ts
type ResolvedTextInput = {
  kind: 'text'
  text: string
  mode: TextInputMode
  source: 'selection' | 'all' | 'empty'
  range?: TextRange
  paneId?: string
  panelId?: string
}
```

Default:

```ts
inputPolicy: {
  mode: 'auto'
}
```

Mode semantics:

- `auto`: if there is non-empty selected text, use the selection; otherwise use the whole active text.
- `all`: always use the whole active text.
- `selection`: use selected text only; if there is no selection, return empty text with `source: 'empty'`.

There is no fallback chain. If no matching text exists, the host passes empty text. The plugin decides whether empty input is valid, produces empty output, or returns a user-facing error.

### Whole Text Versus Selection

The decision must be declarative:

- Use `mode: 'auto'` for most text transforms: selected text when present, otherwise whole active text.
- Use `mode: 'all'` for actions that must operate on the full current text.
- Use `mode: 'selection'` only for rare actions that require a selection.

Plugins should not manually inspect workspace selection state. They receive `ctx.input` after host resolution.

Examples:

```ts
// Reverse selected text if selected, otherwise reverse all active text.
inputPolicy: { mode: 'auto' }

// Format the whole current text.
inputPolicy: { mode: 'all' }

// Wrap only selected text; empty input means the plugin should show an error.
inputPolicy: { mode: 'selection' }
```

### Output Target Policy

Input source and output target must be separate decisions.

```ts
type TextOutputPolicy =
  | { type: 'display' }
  | { type: 'copy' }
  | { type: 'replace-input'; target: 'resolved-input' | 'active-input' | 'active-panel' }
  | { type: 'insert-at-cursor' }
```

Rules:

- Text output defaults to display-as-result-choice in launcher.
- Panel actions may default to replacing the resolved input range when safe.
- Replacing whole panel text requires the resolved input source to be `active-panel` or an explicit target.
- Replacing selection requires a resolved range.
- If no valid target exists, show an error instead of guessing.

This prevents bugs where a command reads selected text but accidentally replaces the whole editor, or reads whole panel text but only replaces a stale selection.

## Notes For Claude

- Treat this as a design migration, not a local bug fix.
- Do not patch quick-entry usage in place and stop; the deeper issue is missing launcher identity/lifecycle.
- Do not make the executor responsible for recommendation data.
- If an API is missing for a plugin, extend `PluginLauncherApi`; do not import workspace internals from plugins.
- Prefer deleting old launcher contribution paths once migrated. This is a personal-use codebase, so long compatibility shims are not required.
