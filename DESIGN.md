# hiven UI & Design System

**Status:** active  
**Last refreshed:** 2026-08-09 (B3/B4 launcher-only hard cut)

## Source of truth

- Brand / anti-references: `PRODUCT.md`
- Framework vs plugin boundary: `AGENTS.md`
- Architecture freeze: `doc/2026-08-09-architecture-freeze-and-convergence.md`

## Product surfaces (current runtime)

| Surface | Role |
|---------|------|
| System tray | Only always-present entry |
| Global Launcher | Search, params, results; hidden window; instant show/hide |
| Host surfaces | Expand in-place: Quick Editor, Settings, Plugins |
| Quick Editor | Monaco; detachable independent window; **single** editor (no multi-pane split) |
| Plugin surface windows | Hosted chrome + plugin body (text-diff, clipboard-history, …) |

**Retired / not product:** main workbench window, icon sidebar rail as primary shell, pinned live tools workbench, multi-pane flexible splitting as host feature.

## Brand

Quiet, precise, capable. Reliable desktop workbench for text.  
Avoid: SaaS landing aesthetics, muddy glass, low-contrast hover, turning host into code-review product.

## Visual scheme

### Light

- Content: `#FFFFFF`
- Chrome / launcher: `#F3F3F3`
- Borders: `#E5E5E5`
- Text: `#000000` / secondary ~`#6F6F6F`
- Accent: `#2563eb`

### Dark

Deep slate/charcoal; accent indigo range (`#3b82f6`). Subtle glass only where useful.

### Type & icons

- UI: system / Inter; content: JetBrains Mono  
- Icons: Lucide line style  
- Density: 10–14px UI scale  

### Motion

- Launcher open/close: **no animation** (high-frequency path)  
- Feedback ≤150ms; structural 150–250ms  
- Respect `prefers-reduced-motion`

### Launcher list (layout reference)

Raycast-like rows: icon + title/sub, type label on the right, neutral selected bar, clean search field. Mixed icons (app bitmaps + line icons for commands) OK for discoverability.

## Design principles

1. Task-first; accent only for primary/selection/state  
2. Crisp neutrals over decorative translucency  
3. Product semantics in **plugins**; host chrome stays minimal  
4. Keyboard primary; IME composition must not confirm  
5. Diff / JSON / Feishu UI are plugins — not host concepts  

## Components (current)

- Launcher list / footer / object block token  
- Host surface frames (settings, plugins, quick editor)  
- Plugin surface shell (title, back/close)  
- `@hiven/plugin-ui` primitives for plugins  

## Non-goals

- Multi-pane IDE workbench as default form factor  
- Diff product model inside framework public SDK  
- Omnipotent OS launcher (screenshot, widgets, file spotlight)  

## Validation

After UI / launcher / plugin-boundary changes:

```bash
npm run check:architecture
npm run check:reachability
npm run test:quality-gate
npm run build
```
