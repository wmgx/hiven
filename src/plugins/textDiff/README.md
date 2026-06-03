# Text Diff

This is the first-party adaptive diff plugin package.

- `index.ts` registers the command and renderer contributions (declares only i18n keys).
- `TextDiffRenderer.tsx` owns the diff UI controls: semantic toggle, JSON semantic status, array compare mode, object key input, close action, and editable dual editor wiring.
- `autoDiffMode.ts` decides whether the same renderer uses JSON semantic diff or text line diff.
- `locales/{en,zh}.json` hold all user-facing copy; code references keys only.

The runtime registration comes from the same source plugin package through the bundled plugin loader.
