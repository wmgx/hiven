# hiven Architecture (current runtime)

**Status:** active  
**Date:** 2026-08-09

## One-liner

Launcher-only plugin host for **precise text work**: Global Launcher is the universal entry; plugins own product semantics (Diff, JSON, Feishu, clipboard history UI).

## Runtime windows

| Window | Entry | Role |
|--------|-------|------|
| launcher | hotkey / tray | Global Launcher + host surfaces |
| quick-editor | detach / open editor | Monaco single editor |
| plugin-surface | plugin open | Hosted plugin UI |

No main workbench / multi-pane IDE window.

## Layers

```text
1. launcher-domain     item, ranking, controller, intent eligibility, output
2. host-runtime        window, surface, context, permissions, storage, output router
3. providers           apps, windows, processes, browser tabs, remote docs
4. plugins             transforms, text-diff, clipboard-history, feishu, …
5. kits                pure algorithms (content, lineDiff, jsonSemantic) — no framework state
```

## Plugin SDK split

| Package | Consumers | Contents |
|---------|-----------|----------|
| `@hiven/plugin` | all plugins | definePlugin, hooks (settings/locale/pane text), content kit, launcher types, storage/network/shell APIs |
| `@hiven/plugin-ui` | plugins with UI | Button, List, toolbar primitives |
| `@hiven/plugin-diff` | **text-diff only** | DualEditorView, line/json diff kits, bound source write-back |

Public SDK must **not** export Diff product models or `useWorkspaceStore` write paths.

## Security narrative (route A)

Plugins run in the same renderer as the host. Permission snapshot is an API convention (least privilege: undeclared = deny). Not a sandbox. Builtin plugins may auto-grant declared permissions except denylist (`shell.run`).

## Quality gate

```bash
npm run test:quality-gate
```

See `doc/2026-08-09-architecture-freeze-and-convergence.md` for B1–B5 freeze order.
