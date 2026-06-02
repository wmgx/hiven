# FluxText Directory Plugin Convention

FluxText framework is a plugin host. It owns registry, command, renderer, panel, workspace, pane IO, editor primitives, settings, context, and effect dispatch. Product-specific capabilities such as diff, compare, JSON, Markdown, AST, or code semantics belong to plugins or kits, not framework runtime.

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

New plugins should use injected host helpers instead of relative framework imports:

```js
const { definePlugin, effects } = globalThis.FluxTextPlugin

export default definePlugin({
  id: 'my-plugin',
  title: 'My Plugin',
  titleI18n: { zh: '我的插件' },
  version: '1.0.0',
  commands: [{
    id: 'my-plugin.run',
    title: 'Run',
    titleI18n: { zh: '运行' },
    inputs: [{ key: 'input', label: 'Input', labelI18n: { zh: '输入' }, kind: 'text', required: true }],
    inputResolution: { strategy: 'use-active', fallback: 'fail' },
    params: [{ key: 'prefix', label: 'Prefix', labelI18n: { zh: '前缀' }, type: 'text', default: '' }],
    run(ctx) {
      const input = ctx.inputs.input
      const text = input?.kind === 'text' ? input.text : ''
      return { effects: [effects.replaceActiveText(String(ctx.params.prefix ?? '') + text)] }
    },
  }],
})
```

Framework internals such as `../workspace/*` are not part of the plugin author contract. First-party source may still live in the repository, but public plugin examples and generated packages should use the injected SDK shape.

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

Existing user scripts under `scripts/` are only a compatibility input. On startup, parseable user scripts are released into `plugins/installed/<plugin-id>/manifest.json` plus `index.js`. Built-in script sources are released into `plugins/builtin`.

There is no migration marker, migration badge, migration field, or migrated-from metadata. 不做迁移 UI, and the app does not show these packages as migrated. After release, the UI treats these packages exactly like any other installed or builtin directory plugin.

## Listing And Editing

The plugin list is directory-first:

- scan `plugins/builtin` for builtin packages;
- scan `plugins/installed` for installed packages;
- read dev packages from the dev session store.

The editor opens a package directory, shows a file tree, switches between files, and saves editable package files. Builtin packages open in read-only mode. The debug panel runs the first command from the current `index.*` plugin definition and keeps legacy `defineAction` parsing only as a fallback for older script-origin files.

## Creating A Plugin

The Plugins page provides **New Plugin**. It creates a dev package under `plugins/dev/<plugin-id>/`, writes `manifest.json`, `index.js`, and `README.md`, side-loads it, and opens the directory editor. The generated `index.js` uses `globalThis.FluxTextPlugin`, so authors can run the command immediately without installing SDK packages or importing from framework paths.

## Update Detection / 更新检测

更新检测 operates on plugin package indexes, not old script indexes. The builtin package index records package ids and index version. Future per-package update checks should compare package metadata such as `pluginId`, `version`, `source`, and `sourceUrl`, then update or replace the whole directory package.
