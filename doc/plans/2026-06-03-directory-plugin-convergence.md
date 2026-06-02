# Directory Plugin Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FluxText use directory-based plugin packages only, remove single-file script import/edit paths, restore directory plugin listing, support GitHub directory and zip imports, replace builtin-script update checks with plugin-package update checks, and migrate legacy user scripts into the new directory shape.

**Architecture:** `scripts/` becomes a compatibility release source, not an active runtime source. Active extensions live under `~/.local/fluxtext/plugins/{builtin,installed,dev}` as folders with metadata-only `manifest.json` and a fixed `index.*` entry. The framework remains a plugin host; concrete text transform commands become first-party or user plugin packages.

**Tech Stack:** Tauri v2 commands, React, Zustand, existing `pluginRuntime`, `pluginStore`, `pluginRegistry`, Monaco only for dev directory file editing.

---

## Decisions

1. **Single-file plugins are removed as an active feature.** Local import accepts folders and zip archives only. Remote import accepts GitHub repository directories or zip URLs only.
2. **Legacy scripts are migrated once.** Existing user `.js` / `.ts` files under the configured scripts directory are converted into user plugin directories, then the app stops registering raw scripts.
3. **Plugin listing moves to directory records.** The visible list shows installed/dev plugin package folders, their manifest data, source type, status, and path.
4. **Editing is dev-only and directory-based.** Keep a minimal directory tree + file switcher + Monaco editor for dev plugins. Do not revive the old single-file script editor or manifest form builder.
5. **Update checks are package checks.** Builtin updates fetch a plugin index/manifest set, compare package versions, and replace whole package folders atomically.

## File Structure

- Modify `src-tauri/src/lib.rs`: add filesystem commands for plugin directories, zip extraction, GitHub directory download helpers, recursive file listing, and atomic directory replacement.
- Modify `src/configInit.ts`: initialize `plugins/builtin`, `plugins/installed`, `plugins/dev`, run legacy migration, and replace builtin script update with builtin plugin package update.
- Modify `src/workspace/pluginTypes.ts`: extend installed records with `source`, `sourceUrl`, `update`, and `packagePath`; add directory/file tree types.
- Modify `src/workspace/pluginStore.ts`: persist directory package metadata, migration marker, and update-check state.
- Modify `src/workspace/pluginRuntime.ts`: expose install/import/update APIs for local folder, zip, GitHub directory, builtin package sync, and legacy script wrapping.
- Modify `src/App.tsx`: load plugins from directory state on startup and stop registering custom raw scripts.
- Replace or heavily modify `src/views/ScriptsView.tsx`: make it a plugin package view with tabs for Builtin, Installed, and Dev; remove single-file import/new/edit actions.
- Modify `src/views/SettingsView.tsx`: either remove duplicate plugin card or link to the main plugin package view so there is one visible management surface.
- Modify `src/components/Sidebar.tsx` and `src/i18n.ts`: rename the visible nav/copy from Scripts to Plugins.
- Create `src/views/PluginEditorView.tsx`: dev-only directory tree, file switcher, Monaco editor, save/reload actions.
- Create `src/workspace/legacyScriptPlugin.ts`: wrapper that converts a legacy `ActionDef` into a `PluginDefinition` command without keeping raw scripts as runtime entries.
- Create tests or focused verification fixtures under the existing test convention once the repo test harness is confirmed.

## Task 1: Runtime Directory Model

**Files:**
- Modify: `src/workspace/pluginTypes.ts`
- Modify: `src/workspace/pluginStore.ts`
- Modify: `src/workspace/pluginRuntime.ts`

- [ ] Define plugin package records with these fields: `pluginId`, `displayName`, `displayNameI18n`, `version`, resolved fixed `entry`, `capabilities`, `folderPath`, `source`, `sourceUrl`, `status`, `error`, `installedAt`, `updatedAt`.
- [ ] Keep production and dev registries separate exactly as today; only replace the package discovery/import surface.
- [ ] Add `loadInstalledPluginsFromStore()` that enables every persisted plugin whose status was `enabled` after validating its folder still exists.
- [ ] Add `getPluginPackageSummary(folderPath)` that reads `manifest.json` and returns display data for list rendering.
- [ ] Verify with `npm run check:architecture` that no diff/compare product concept leaks into framework types.

## Task 2: Tauri Plugin Filesystem Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] Add `list_plugin_dirs(path)` returning directories that contain `manifest.json`.
- [ ] Add `read_plugin_file(path)` and `save_plugin_file(path, content)` guarded to text extensions used by plugin development.
- [ ] Add `list_plugin_files(path)` returning a recursive tree excluding `node_modules`, `dist`, `.git`, and binary files.
- [ ] Add `install_plugin_zip(zip_path, destination_root)` that extracts to a temp folder, finds the package root containing `manifest.json`, then atomically moves it into `destination_root/{pluginId}`.
- [ ] Add `fetch_github_directory(owner, repo, branch, path, destination_root)` using the GitHub contents API or codeload zip fallback, then install it as a package folder.
- [ ] Keep network imports read-only until the final folder replacement step; never delete an existing installed plugin without an explicit overwrite path.

## Task 3: Legacy Script Migration

**Files:**
- Modify: `src/configInit.ts`
- Modify: `src/App.tsx`
- Create: `src/workspace/legacyScriptPlugin.ts`

- [ ] During `initConfigDir()`, create `plugins/builtin`, `plugins/installed`, and `plugins/dev`.
- [ ] If migration marker `plugins/.migrated-scripts-v1` is absent, scan old `scripts/` for non-builtin `.js` / `.ts` files.
- [ ] For each valid legacy action, write `plugins/installed/user-{safeName}/manifest.json` and `entry.js`.
- [ ] The generated `index.js` exports a normal `PluginDefinition` with one command that calls the script action `run(ctx)` and maps `{ text }` to the current workspace text-output effect already used by commands.
- [ ] After migration succeeds, write the marker with migrated file names and leave original files untouched for rollback.
- [ ] Stop `App.tsx` from calling `read_scripts_dir` for custom scripts.

## Task 4: Plugin Package List UI

**Files:**
- Replace or modify: `src/views/ScriptsView.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/i18n.ts`
- Modify: `src/views/SettingsView.tsx`

- [ ] Rename the primary visible section to Plugins.
- [ ] Render plugin directories from `usePluginStore`: Builtin, Installed, Dev.
- [ ] Show folder path, package source, version, status, capabilities, and error state.
- [ ] Provide actions: Enable, Disable, Reload, Check Update, Uninstall, Side-load Dev, Watch Dev, Open Directory Editor.
- [ ] Remove buttons and modal paths for creating/importing single `.js` / `.ts` files.
- [ ] Remove duplicate plugin management UI from Settings or make it a compact link to the Plugins view.

## Task 5: Folder, GitHub Directory, And Zip Import

**Files:**
- Modify: `src/workspace/pluginRuntime.ts`
- Modify: `src/views/ScriptsView.tsx`
- Modify: `src-tauri/src/lib.rs`

- [ ] Local import opens a directory picker and calls `installLocalPlugin(folder)`.
- [ ] Zip import opens a file picker restricted to `.zip`, extracts into `plugins/installed`, validates `manifest.json`, and installs disabled by default.
- [ ] Remote import accepts GitHub directory URLs in the forms `https://github.com/{owner}/{repo}/tree/{branch}/{path}` and `https://github.com/{owner}/{repo}`.
- [ ] Remote import rejects raw `.js` / `.ts` URLs with a clear error that single-file plugin import is no longer supported.
- [ ] Store `sourceUrl` and `source = github | zip | local` on installed plugin records so update detection can use the right mechanism.

## Task 6: Package Update Checks

**Files:**
- Modify: `src/configInit.ts`
- Modify: `src/workspace/pluginRuntime.ts`
- Modify: `src/workspace/pluginStore.ts`
- Modify: `src/views/ScriptsView.tsx`

- [ ] Replace `checkBuiltinScriptsUpdate()` with `checkBuiltinPluginsUpdate()`.
- [ ] Builtin package index contains package folder names, manifest versions, and file list or zip URL.
- [ ] Installed GitHub plugins check remote `manifest.json` for the same package path and compare semver-like versions.
- [ ] Zip/local plugins can only be reinstalled manually unless `sourceUrl` points to an updateable zip.
- [ ] Update writes to a temp folder, validates manifest id/version, disables the old plugin if enabled, atomically replaces the folder, then re-enables if it was previously enabled.

## Task 7: Dev Directory Editor

**Files:**
- Create: `src/views/PluginEditorView.tsx`
- Modify: `src/store.ts`
- Modify: `src/App.tsx`
- Modify: `src/workspace/pluginRuntime.ts`

- [ ] Add an editor view state that records the opened dev plugin folder and active file.
- [ ] Render a directory tree from `list_plugin_files`.
- [ ] Load selected text files with `read_plugin_file`.
- [ ] Save with `save_plugin_file`, then offer Reload or rely on Watch if enabled.
- [ ] Restrict editing to dev plugins; installed/builtin packages are view-only from the list.

## Task 8: Verification

**Files:**
- All touched files.

- [ ] Run `git status --short --ignored` and inspect untracked/runtime artifacts before staging.
- [ ] Run `npm run check:architecture`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run build`.
- [ ] For UI changes, start the app/dev server and verify the plugin list renders directory plugins, single-file import is absent, and directory editor switches files without text overlap.

## Risks

- Legacy script `run` functions may contain TypeScript-only syntax that cannot be dynamically imported as plain JS. The migration must either preserve the old parse/eval wrapper inside `legacyScriptPlugin.ts` or emit a wrapper that stores the original source as a string and parses it at runtime.
- GitHub directory import can hit unauthenticated API rate limits. The fallback should support codeload zip URLs where possible.
- Tauri zip extraction introduces a new dependency and filesystem risk. Extraction must validate paths and reject zip-slip entries before writing.
- Replacing the current Scripts view is a product-visible change; browser verification is required, not just build success.
