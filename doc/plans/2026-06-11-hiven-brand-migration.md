# hiven Brand Migration Plan

**Goal:** Rename FluxText to hiven across runtime identity, repository/release wiring, local data paths, and plugin authoring APIs while preserving existing user data.

**Scope:** Runtime source, build metadata, CI release name, updater endpoints, local config migration, storage-key migration, first-party plugin imports, and GitHub repository rename. Historical documents under `doc/archive` and older design documents are intentionally out of scope unless they affect current runtime or tests.

**Stages:**

1. Add a focused verification script for the migration contract.
2. Rename app/package/Tauri/Cargo/CI metadata to hiven.
3. Move runtime paths and persisted keys to hiven, with one-time fallback from legacy FluxText keys and `~/.local/fluxtext`.
4. Introduce `@hiven/plugin` and `globalThis.HivenPlugin` as primary plugin APIs while keeping deprecated FluxText aliases during migration.
5. Replace internal Tauri event channels with `hiven://...`.
6. Run project gates and then rename GitHub repository `wmgx/flux_text` to `wmgx/hiven`, updating local `origin`.

**Verification:**

- `npm run test:hiven-brand-migration`
- `npm run check:architecture`
- `git diff --check`
- `npm run build`
- `gh repo view wmgx/hiven --json name,nameWithOwner,url,viewerPermission`

