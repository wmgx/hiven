# Remove Blank Lines

First-party command-only plugin package.

- `index.ts` declares a single command that removes blank/whitespace-only lines from the active input.
- `manifest.json` holds package metadata.
- `locales/{en,zh}.json` hold all user-facing copy; the contribution references keys only.

This package is the reference example for migrating a legacy `defineAction` text transform onto the `definePlugin` package structure.
