# Text Diff

This is the first-party adaptive diff plugin package.

- `index.ts` registers the command and renderer contributions (declares only i18n keys).
- `TextDiffSurface.tsx` owns the diff UI controls: semantic toggle, JSON semantic status, array compare mode, object key input, close action, and editable dual editor wiring.
- `locales/{en,zh}.json` hold all user-facing copy; code references keys only.

The runtime registration comes from the same source plugin package through the bundled plugin loader.
