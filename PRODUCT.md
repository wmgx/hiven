# Product

## Register

product

## Users

Developers and technical users on macOS who want one hotkey to launch, switch, compute, look up, and act on whatever they are holding right now, without leaving the current app.

## Product Purpose

hiven is an all-in-one macOS launcher that understands the user's current context. It reads what is in hand (selection, clipboard, foreground app, browser page), recognizes content, and uses AI to understand intent and route it to existing capabilities. Local deterministic results come first; AI understands and falls back, never blocks the first frame, is optional, and never runs side-effecting actions on its own. Success means the first result is usually the right one, it appears instantly, and nothing changes the user's foreground app.

Not in scope: workflow/automation authoring, global file search, third-party plugin marketplace (for now), official Windows/Linux support.

## Brand Personality

Quiet, precise, capable. The product should feel like a reliable desktop workbench: familiar enough to trust, polished enough to reduce friction, and restrained enough to keep attention on the text.

## Anti-references

Avoid decorative SaaS landing-page styling, muddy glassmorphism, low-contrast gray-on-tinted surfaces, and hover states that make controls harder to read. Plugin and diff surfaces should not look like code-review products unless the plugin specifically needs that model.

## Design Principles

- Keep the interface task-first: controls should explain themselves through placement, labels, and standard affordances.
- Use accent color only for primary actions, selection, and state feedback.
- Prefer crisp neutral surfaces over heavy translucency or decorative gradients.
- Preserve plugin boundaries: product semantics belong in plugins, while the host stays visually consistent and minimal.
- Every interactive state must remain readable and visually stable.

## Accessibility & Inclusion

Target WCAG AA contrast for text and controls. Hover, focus, disabled, and selected states should be distinguishable without relying on color alone where practical. Motion should be short, state-driven, and respectful of reduced-motion preferences.
