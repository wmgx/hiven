# Host Launcher, Schema Settings, and Light UI Refresh Plan

> **For agentic workers:** This is a boundary-setting implementation design. Do not start by rewriting UI files globally. Preserve unrelated user changes, keep commits scoped, and verify each phase with the checks listed below.

## Goal

Move application-launching and pane-control entry points into the Hiven host, redesign plugin settings around host-rendered schema forms with optional host-owned plugin modals, and implement the new light-mode UI direction from `doc/hiven-all-in-one.html` and `doc/hiven-launcher-v3.html` without copying their inconsistent typography one-to-one.

The intended product model is:

```text
host launcher = application actions + workspace actions + plugin-contributed tools
plugins       = text tools, renderer products, custom surfaces, settings schema/modal body
framework     = shell, registry, lifecycle, ranking, permissions, storage, layout primitives
```

## Inputs

- `doc/hiven-all-in-one.html`
- `doc/hiven-launcher-v3.html`
- `DESIGN.md`
- `PRODUCT.md`
- Existing launcher domain under `src/workspace/launcher/*`
- Existing settings implementation under `src/workspace/pluginSettingsStore.ts` and `src/components/PluginSettingsDialog.tsx`
- Existing app-launcher plugin under `src/plugins/app-launcher/*`
- Existing clipboard-history surface and settings under `src/plugins/clipboard-history/*`

## Non-Goals

- Do not move JSON, Base64, Diff, clipboard history, web quick open, or text tools into host.
- Do not implement dark mode visuals in this pass. Only preserve token hooks and avoid light-only component assumptions.
- Do not migrate the old `app-launcher` plugin private index/cache into the new host app index.
- Do not turn toolbar plugin contribution into the main blocker. Implement or preserve the slot only if it is cheap in the selected phase.
- Do not make Diff a framework capability. Diff remains plugin-owned.
- Do not let plugins render arbitrary settings shell chrome. Host owns shell, modal, sizing, permissions, focus, close, and error boundary.

## Core Decisions

### 1. Application Launcher Moves To Host

The application launcher is no longer a plugin product. It becomes a host-owned launcher provider.

Host owns:

- Application discovery.
- Application index/cache.
- Application icon cache and icon ref resolution.
- Refresh lifecycle.
- Application launch by stable `appId`.
- Permission and failure presentation.
- Empty/recent/suggested application rows in GlobalLauncher.

Plugins no longer own:

- `src/plugins/app-launcher` as a user-visible plugin.
- `app-launcher:index:*` private cache as source of truth.
- Product copy such as "刷新应用索引".
- Dynamic app result generation.

The old plugin cache is not migrated. The new host app index starts empty and is rebuilt by refresh.

Suggested host modules:

```text
src/workspace/appLauncher/
  appIndex.ts
  appLauncherProvider.ts
  appLauncherStore.ts
  appIconRefs.ts
  types.ts
```

The native Tauri commands can be reused initially:

```text
discover_installed_apps
cache_installed_app_icons
launch_installed_app
```

If the commands currently assume plugin permissions, keep permission enforcement at the host launcher action layer and avoid exposing these calls as general plugin API for the app-launcher use case.

### 2. Pane Control Moves To Host Launcher

Pane control is also a host-owned launcher capability, not a plugin. It directly manipulates workspace pane state.

First host actions:

- New pane.
- Split pane right.
- Split pane down.
- Close current pane.
- Focus next pane.
- Focus previous pane.

These actions should be contributed through host launcher providers, not through a bundled plugin. They may appear in GlobalLauncher and CommandPalette if they are useful in both surfaces.

Suggested module:

```text
src/workspace/launcher/hostActions.ts
```

Rules:

- Use host-generated `systemKey` values.
- Record usage through existing launcher selection usage.
- Do not route through plugin `effects` unless an existing workspace API already requires that boundary.
- Keep app launching and pane control separate providers so future UI grouping remains possible without changing identity.

### 3. Plugin Settings Become Schema-First

Plugin settings should support two capabilities:

1. Host-rendered settings from plugin schema.
2. A schema-declared action that opens a host-owned modal and renders a plugin-defined settings surface inside it.

The new shape should coexist with the current component model during migration.

Proposed type sketch:

```ts
type PluginSettingsContribution<TSettings = unknown> = {
  title?: string
  titleI18n?: Partial<Record<Locale, string>>
  version?: number
  defaultValue: TSettings
  migrate?: (stored: unknown, fromVersion: number) => TSettings
  schema?: PluginSettingsSchema<TSettings>
  component?: ComponentType<PluginSettingsBodyProps<TSettings>> // legacy fallback
}

type PluginSettingsSchema<TSettings = unknown> = {
  sections: PluginSettingsSection<TSettings>[]
}

type PluginSettingsSection<TSettings = unknown> = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  fields: PluginSettingsField<TSettings>[]
}
```

Field kinds for v1:

```ts
type PluginSettingsField<TSettings = unknown> =
  | { kind: 'switch'; key: keyof TSettings & string; label: string; labelI18n?: Partial<Record<Locale, string>>; description?: string; descriptionI18n?: Partial<Record<Locale, string>> }
  | { kind: 'number'; key: keyof TSettings & string; label: string; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'select'; key: keyof TSettings & string; label: string; options: Array<{ label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }> }
  | { kind: 'text'; key: keyof TSettings & string; label: string; placeholder?: string; mono?: boolean }
  | { kind: 'textarea'; key: keyof TSettings & string; label: string; placeholder?: string; mono?: boolean; rows?: number }
  | { kind: 'list'; key: keyof TSettings & string; label: string; itemSchema: PluginSettingsSchema<unknown>; addLabel?: string }
  | { kind: 'modal'; id: string; label: string; description?: string; surfaceId: string; buttonLabel?: string }
```

The `modal` field is the important escape hatch. It is still a schema entry, but pressing it asks host to open a modal shell and render a plugin settings surface.

### 4. Plugin Settings Modal Is Host-Owned

Plugin modal settings surfaces should be registered by the plugin, but opened through host schema rendering.

Proposed UI contribution extension:

```ts
type PluginSettingsModalSurface<TSettings = unknown> = {
  id: string
  kind: 'settings-modal'
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  width?: number
  height?: number
  component: ComponentType<PluginSettingsModalProps<TSettings>>
}
```

Host owns:

- Modal shell.
- Overlay/floating placement.
- Title and close affordance.
- Focus trap and Escape handling.
- Error boundary.
- Permission gate.
- Settings value props and write APIs.

Plugin owns:

- Modal body content.
- Plugin-specific complex editing UI.
- Validation copy for plugin-specific fields.

This supports cases like web quick open rule editing without forcing every complex list editor into generic schema on day one.

### 5. Plugin Detail Page Renders Schema

The plugin detail page becomes the primary settings surface for plugins.

Detail page layout:

```text
header: icon, name, version, source/path
summary: description
actions: open plugin surface if any, enable/disable if applicable
settings: host-rendered schema
shortcuts: surface shortcut bindings
permissions: granted/missing status and grant actions
danger zone: reset settings / clear private storage when applicable
capability tags: command / launcher / renderer / toolbar / surface / background
```

Rules:

- If `settings.schema` exists, render it inline.
- If only `settings.component` exists, show a compatibility row that opens the legacy component in the host modal.
- If both exist, schema is primary; component/modal is only opened by schema `modal` fields.
- Settings save behavior remains live-save unless a schema field explicitly requests draft behavior later.
- The detail page must work for builtin, installed, and dev plugins.

### 6. Light UI And Typography Are Implemented From Tokens

The HTML mocks are references, not literal implementation specs. The current mocks use many near-duplicate font sizes. Implementation should collapse typography into a small product scale.

Recommended scale:

```css
--text-xs: 10px;
--text-sm: 11px;
--text-body: 12px;
--text-base: 13px;
--text-title: 14px;
--text-large: 16px;
```

Use the existing Light+ direction:

```text
content/editor: #ffffff
chrome/surface: #f3f3f3 / #f5f5f6
border: #e5e5e5
primary text: #000000 / #1e1e1e
secondary text: #6f6f6f
accent: #007acc
```

Implementation rules:

- Prefer CSS variables over hard-coded colors in React components.
- Preserve dark token slots, even if dark visual polish is deferred.
- Do not introduce nested cards for page sections.
- Use lucide icons where practical; avoid emoji icons in production UI except where existing plugin data only has text icons.
- Launcher selected rows should remain stable under keyboard and pointer navigation.

### 7. Clipboard History Permission Gaps

Clipboard history remains a privileged plugin. The host should improve its permission missing state in the current UI style.

Required states:

- Missing permission gate in launcher/plugin surface.
- Granted state summary in plugin detail page.
- Error state when background recording fails.
- Empty state when no records exist.
- Privacy note in settings/detail area, matching current concise product voice.

The permission gate should list only actionable missing permissions and provide:

- Grant/allow action.
- Back/close action.
- Short privacy warning when clipboard/image/file permissions are involved.

### 8. Topbar

Topbar has two zones:

```text
system fixed buttons | plugin-contributed toolbar slot
```

System fixed buttons are host-owned and may be implemented first:

- Undo.
- Redo.
- Word wrap.
- Find/replace.
- Split pane.

Plugin toolbar contribution can remain the existing capability if it already supports the needed slot. If it does not, this phase may only preserve a visual/plugin slot and leave full toolbar protocol expansion for a later plan.

Do not hard-code product plugin commands like JSON/Base64/Diff into the host topbar.

## Data Flow

### Launcher Candidate Flow

```text
host app provider
host pane-control provider
host view/settings provider
plugin launcher items
plugin dynamic items
        ↓
collectStaticCandidates / collectDynamicItems
        ↓
shared ranking and usage
        ↓
CommandPalette / GlobalLauncher render
        ↓
LauncherController execution lifecycle
```

The host app provider should produce normal launcher items with host execution handlers. It should not masquerade as a plugin item.

### Settings Flow

```text
plugin definition
  settings.defaultValue
  settings.migrate
  settings.schema
  settings.component fallback
  ui.surfaces(kind=settings-modal)
        ↓
resolvePluginSettings(source, pluginId, settings)
        ↓
PluginDetailPage renders schema inline
        ↓
schema field updates plugin settings store
        ↓
schema modal field opens host modal
        ↓
plugin modal body receives same settings props
```

## Migration Plan

### Phase 1: Types And Host Providers

Deliverables:

- Add host launcher provider support for app launching and pane control.
- Move app launcher index/cache out of plugin private storage into host app state.
- Keep existing native app discovery/launch commands.
- Stop registering `src/plugins/app-launcher` as a bundled plugin.
- Add tests for host app provider item identity, refresh, search, and launch error handling.
- Add tests for pane control launcher actions.

Acceptance:

- Applications appear in GlobalLauncher after host refresh.
- App launch success closes the launcher silently.
- App launch failure keeps launcher open with a readable error.
- Old plugin cache is ignored.
- Pane actions execute without plugin permissions.

### Phase 2: Settings Schema Infrastructure

Deliverables:

- Extend plugin type definitions with `settings.schema`.
- Implement host schema renderer primitives.
- Implement schema `modal` field.
- Add host-owned plugin settings modal shell.
- Keep current `settings.component` compatible.
- Add validation/migration tests for schema settings.

Acceptance:

- A simple plugin can expose settings without a React settings component.
- A complex plugin can expose a modal through schema and render plugin-owned body inside host shell.
- Settings persist under existing `source + pluginId` storage.
- A crashing modal body does not crash the app or plugin detail page.

### Phase 3: Plugin Page Redesign

Deliverables:

- Rework plugin list/detail page to match the new light UI direction.
- Render schema settings inline.
- Show legacy settings component as a modal fallback.
- Show shortcut bindings for plugin surfaces.
- Show permission state and grant actions.
- Show capability tags and empty/no-settings states.

Acceptance:

- Builtin plugin count remains correct.
- Search uses shared matching helper.
- Plugin details do not hard-code settings for specific plugins.
- Clipboard history, web quick open, and simple text plugins all render sensible details.

### Phase 4: Launcher UI Refresh

Deliverables:

- Apply launcher visual structure from `doc/hiven-launcher-v3.html`.
- Normalize typography to tokens.
- Add selected result navigation for multi-result output if in scope.
- Add long text/code preview fallback for result output if in scope.
- Preserve IME-safe Enter/Backspace behavior.
- Preserve standalone launcher sizing and non-activating window behavior.

Acceptance:

- Empty launcher, query results, collect-input, params, and result frames all match the new visual language.
- Existing live preview Enter-to-copy behavior remains intact.
- Dynamic app rows show real icons when available.
- Keyboard navigation remains stable.

### Phase 5: Clipboard History And Topbar Polish

Deliverables:

- Improve clipboard-history permission/empty/error states.
- Implement system fixed topbar buttons.
- Preserve or expose plugin toolbar contribution slot.

Acceptance:

- Clipboard history missing-permission state is understandable and actionable.
- Topbar system actions work without plugin involvement.
- Plugin toolbar slot does not require host hard-coding product plugin semantics.

## File Areas

Likely host files:

```text
src/workspace/launcher/*
src/components/GlobalLauncher.tsx
src/components/CommandPalette.tsx
src/views/ScriptsView.tsx
src/components/PluginSettingsDialog.tsx
src/workspace/pluginTypes.ts
src/workspace/pluginSettingsStore.ts
src/workspace/pluginRegistry.ts
src/workspace/pluginPermissions.ts
src/workspace/pluginRuntime.ts
src/workspace/bundledPluginLoader.ts
src/index.css
src/store.ts
src-tauri/src/lib.rs
```

Likely plugin files:

```text
src/plugins/app-launcher/*
src/plugins/web-open/*
src/plugins/clipboard-history/*
src/plugins/*/index.*
src/plugins/*/manifest.json
src/builtin-plugins/index.json
```

Expected new files:

```text
src/workspace/appLauncher/*
src/workspace/pluginSettingsSchema.ts
src/components/PluginSettingsSchemaRenderer.tsx
src/components/PluginSettingsModal.tsx
src/workspace/launcher/hostActions.ts
```

## Tests And Verification

Per phase, use narrow tests first. Before claiming complete, run:

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

High-signal targeted tests to add or update:

```text
scripts/test-launcher-controller.mjs
scripts/test-launcher-registry.mjs
scripts/test-launcher-ranking.mjs
scripts/test-app-launcher-contract.mjs
scripts/test-command-palette-page-policy.mjs
scripts/test-command-palette-system-page-shortcuts.mjs
scripts/test-plugin-settings-dialog-keyboard.mjs
scripts/test-plugin-surface-shortcuts.mjs
scripts/test-clipboard-history-runtime.mjs
scripts/test-clipboard-history-settings.mjs
scripts/test-plugin-ui-primitives.mjs
```

New tests should cover:

- Host app launcher provider does not depend on plugin registry.
- Old app-launcher plugin cache is ignored.
- Pane-control actions are host items and do not request plugin permissions.
- Schema fields read/write nested settings correctly.
- Schema modal opens host shell and renders plugin body.
- Legacy `settings.component` remains usable during migration.
- Clipboard-history permission gate lists missing permissions and can grant them.
- Launcher IME behavior remains safe after UI refresh.

## Risks

- Moving app launcher out of plugin can accidentally duplicate app results if the old plugin remains registered. Remove or disable registration before adding host provider.
- Settings schema can become too large if it tries to model every complex UI. Keep `modal` as the escape hatch.
- Plugin detail page can accidentally become plugin-specific if web quick open list editing is hard-coded. Prefer schema/list renderer or modal body.
- Launcher UI refresh can regress standalone window sizing. Preserve intrinsic height measurement and native window handoff behavior.
- Topbar can leak product plugin semantics into host. Keep system buttons fixed and plugin commands contributed through slot.
- Clipboard permissions can become noisy. Show only missing/actionable permissions by default.

## Open Questions

- Should host app index refresh be only manual in v1, or should startup stale refresh remain as a host setting?
- Should pane-control host actions appear in CommandPalette as well as GlobalLauncher?
- Which complex plugins should migrate to schema first: web quick open, clipboard history, or a small simple plugin as a proving ground?
- Should schema support draft/save semantics in v1, or is live-save enough for this pass?

## Recommended Execution Order

1. Add settings schema types and renderer with one small plugin migration.
2. Move app launcher to host provider and remove bundled app-launcher registration.
3. Add pane-control host launcher actions.
4. Redesign plugin detail page around schema settings.
5. Refresh GlobalLauncher visual states and typography.
6. Patch clipboard-history permission/empty/error states.
7. Implement topbar fixed system buttons and preserve plugin slot.

This order keeps the riskiest shared contract change visible early while avoiding a full UI rewrite before the data model is stable.
