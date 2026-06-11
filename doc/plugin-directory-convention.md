# hiven Directory Plugin Convention

hiven framework is a plugin host. It owns registry, command, renderer, panel, workspace, pane IO, editor primitives, settings, context, and effect dispatch. Product-specific capabilities such as diff, compare, JSON, Markdown, AST, or code semantics belong to plugins or kits, not framework runtime.

## Directory Roots

Runtime plugins are directory packages under the user config directory:

```text
plugins/
  builtin/     first-party packages released by the app
  installed/   user-installed production packages
  dev/         local development packages
```

`builtin` packages are read-only references in the UI. First-party builtin packages that own UI should release their source files into the directory instead of exposing only `manifest.json`. Diff is one adaptive `text-diff` plugin package: the same renderer handles plain text line diff and JSON semantic diff based on input validity. `json-diff` is not a separate first-party package. `installed` packages can be enabled, disabled, reloaded, edited, or uninstalled. `dev` packages are session-scoped development packages and can be watched or reloaded.

## Package Shape

The directory is the plugin package:

```text
<plugin-id>/
  manifest.json
  index.js        production ESM entry
  index.ts        optional dev source entry
  README.md
  assets/
```

`manifest.json` contains package metadata only. It should contain `pluginId`; `displayName`, `displayNameI18n`, `version`, and `capabilities` are optional. It must not contain an `entry` field. Runtime entry is fixed by convention: `index.tsx`, `index.ts`, `index.jsx`, `index.js`, then `index.mjs`, in that order. Production packages should ship browser-loadable ESM (`index.js` or `index.mjs`); dev packages can keep source entries while the dev loader/transpiler matures. The directory name should match `pluginId`; when imported from zip or GitHub, the importer normalizes the final installed directory to the manifest `pluginId`.

The entry file exports the plugin definition. Plugin name customization lives in `manifest.displayName` and `manifest.displayNameI18n` for package lists, and in `definePlugin({ title, titleI18n })` plus contribution `title/titleI18n` for runtime UI. Parameters are declared on command contributions through `params`, using `boolean`, `text`, `number`, `single-select`, or `multi-select`, with `labelI18n`, `default`, `required`, and option labels.

New plugins should use injected host helpers instead of relative framework imports. The host SDK is available as `globalThis.HivenPlugin` (with deprecated `globalThis.FluxTextPlugin` compatibility during migration) and, for first-party bundled plugins, via `getPluginHostSdk()` from `@hiven/plugin`. It currently exposes:

- `definePlugin` for the plugin definition.
- `react` — the shared host React instance (plugins must not bundle their own).
- `effects` for standard command effects.
- `ui` for host-styled primitive components: `ui.Button`, `ui.TextInput`, `ui.Select`, `ui.Checkbox`, `ui.Stack`, `ui.Text`, `ui.CodeBlock`, and `ui.EmptyState`.
- `kits` for reusable rendering helpers: `kits.DualEditorView` and `kits.diff.*` (`computeTextLineDiff`, `buildDiffTree`, `buildJsonDiffViewModel`, `buildSideLines`, `parseJson`).
- `hooks` for read-only store access: `hooks.useSettings`, `hooks.useLocale`, `hooks.usePaneText`, and `hooks.useT(pluginId)`.
- `i18n.makeT(pluginId, locale)` for building a namespaced translate function outside React.

> IMPORTANT: never destructure the SDK at module top level. Bundled first-party plugins are evaluated before the host globals are installed, so always call `getPluginHostSdk()` (or read `globalThis.HivenPlugin`) inside a component body or `run()`.

```js
const { definePlugin, effects, ui } = globalThis.HivenPlugin;

export default definePlugin({
  id: 'my-plugin',
  title: 'My Plugin',
  titleI18n: { zh: '我的插件' },
  version: '1.0.0',
  commands: [
    {
      id: 'my-plugin.run',
      title: 'Run',
      titleI18n: { zh: '运行' },
      live: { pinnable: true },
      inputs: [
        {
          key: 'input',
          label: 'Input',
          labelI18n: { zh: '输入' },
          kind: 'text',
          required: true,
        },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      params: [
        {
          key: 'prefix',
          label: 'Prefix',
          labelI18n: { zh: '前缀' },
          type: 'text',
          default: '',
        },
      ],
      run(ctx) {
        const input = ctx.inputs.input;
        const text = input?.kind === 'text' ? input.text : '';
        return {
          effects: [
            effects.replaceActiveText(String(ctx.params.prefix ?? '') + text),
          ],
        };
      },
    },
  ],
});
```

`live.pinnable` controls whether the command can appear as a pinned runner. Text-in/text-out commands can omit it or set `true`; commands that open panels, set renderers, or mutate workspace layout should set `live: { pinnable: false }`.

Framework internals such as `../workspace/*` are not part of the plugin author contract. First-party source may still live in the repository, but public plugin examples and generated packages should use the injected SDK shape. First-party renderers consume the SDK through `getPluginHostSdk()` (imported from the `@hiven/plugin` alias), never via `../../workspace`, `../../store`, `../../i18n`, or `../../kits` deep paths.

## i18n Convention

A plugin package localizes its strings through a per-package `locales/` directory:

```text
<plugin-id>/
  locales/
    en.json
    zh.json
```

Each locale file is a flat `{ key: message }` map. Messages may contain `{name}` placeholders interpolated from `vars`. On load, the host registers these dictionaries under the `pluginId` namespace.

Contribution declaration fields (`title`, `description`, input/param `label`, param `hint`, and option labels) are authored as plain locale keys. At load time the host expands each key into the existing `{ text, titleI18n }` protocol using the plugin's `locales/`, so the command palette and other views localize them with zero awareness of plugin namespaces. If a field value is not a key present in `locales/`, it is left as a literal string (legacy inline strings keep working).

Runtime UI strings inside a renderer/panel are resolved by the plugin itself:

- In a React renderer/panel: `const t = hooks.useT('<plugin-id>')` then `t('some.key', { count })`.
- Outside React: `const t = i18n.makeT('<plugin-id>', locale)`.

Resolution uses a three-level fallback: plugin namespace (current locale → `en`) → host global dictionary → the raw key. The first-party `text-diff` package is the reference example: its `index.ts` declares only keys (`command.compare.title`, `input.original.label`, `renderer.title`, …) and `TextDiffRenderer` uses `hooks.useT('text-diff')`, with all copy living in `locales/{en,zh}.json`.

## Import Contract

Supported imports:

- Local plugin directory.
- GitHub repository directory.
- Zip archive containing a plugin directory.
- Dev local directory.

Unsupported imports:

- Bare `.js` or `.ts` single-file plugin import.
- Remote single-file GitHub raw/blob URLs.

Importers copy packages into `plugins/installed` or `plugins/dev`, validate the manifest and entry path, and register directory metadata. Entry paths must stay package-relative and cannot escape the plugin directory.

## Compatibility Release

There is no legacy `defineAction` compatibility release. The app no longer parses bare scripts under `scripts/` into plugin packages; all capabilities — first-party and user — are authored as directory plugin packages (`manifest.json` + fixed `index.*` + `locales/`). The legacy single-file `defineAction` authoring format and its in-app debugger have been removed.

There is no migration marker, migration badge, migration field, or migrated-from metadata. 不做迁移 UI.

## Listing And Viewing

The plugin list is directory-first:

- scan `plugins/builtin` for builtin packages;
- scan `plugins/installed` for installed packages;
- read dev packages from the dev session store.

The in-app plugin view is **read-only**: it opens a package directory, shows a file tree, and lets you read source files. It does not edit, save, or debug source in-app. Editing is delegated to an external IDE — dev packages expose an "open in external editor" action that launches VS Code (`code` CLI) when available, falling back to the system file manager.

## Creating A Plugin

The Plugins page provides **New Plugin**. It creates a dev package under `plugins/dev/<plugin-id>/`, writes `manifest.json`, `index.js`, and `README.md`, side-loads it, and opens the package directory in an external editor (VS Code → system file manager). The generated `index.js` uses `globalThis.HivenPlugin`, so authors can run the command immediately without installing SDK packages or importing from framework paths. Saving in the external editor triggers Watch-based hot reload back in the app.

## Update Detection / 更新检测

更新检测 operates on plugin package indexes, not old script indexes. The builtin package index records package ids, package directories, package versions, and index version only. It does not list package files: the directory is the plugin package, and file discovery is an internal release/update concern. Future per-package update checks should compare package metadata such as `pluginId`, `version`, `source`, and `sourceUrl`, then update or replace the whole directory package.
