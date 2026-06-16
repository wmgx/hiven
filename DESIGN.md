# hiven / FluxText UI & Design System (2026 Refresh)

## Source of truth
- Status: Active (final scheme chosen 2026-06-16; sidebar finalized to pure-icon simple style per user 2026-06-16)
- Last refreshed: 2026-06-16
- Primary product surfaces: Main workbench (editor panes, sidebar/rail, topbar, status), Global Launcher, Command Palette, Plugins view, Pinned Runner, Settings, plugin surfaces (hosted shells).
- Evidence reviewed: PRODUCT.md (brand: Quiet, precise, capable. Reliable desktop workbench. Avoid decorative SaaS, muddy glassmorphism, low-contrast gray-on-tinted, hover states that hurt readability), AGENTS.md (framework owns shell/renderer/pane state/editor primitive; plugins own product semantics like diff, JSON, clipboard history UI; no leaking Monaco details into host concepts; validation after changes), current-state-board-v2.html (factual baseline: 44px icon sidebar, thin 0.5px borders, small JetBrains Mono, purple accent in light ref, compact 4-pane example, launcher/palette overlays, plugin cards with error visibility), src/ code (React 19 + Tailwind + CSS vars with some glass, Tauri), previous iteration feedback (too flat, 10-year-old style, ugly colors, limited by old layout), final user approval of VS Code Light+ inspired scheme.

## Final chosen visual scheme
- **Light mode**: VS Code default Light+ (Default Light+) inspired clean cold high-end white.
  - Content/Editor surfaces: pure #FFFFFF.
  - Chrome/panels/rail/status/launcher bg: #F3F3F3 (classic VS Code light gray – clean, not dirty/muddy).
  - Borders: #E5E5E5 (subtle, present).
  - Primary text: #000000 (high contrast); secondary ~#6F6F6F.
  - Accent: #007ACC (VS Code blue, professional and pops cleanly on white).
  - Overall: crisp, high-contrast, premium desktop feel. No warm tints, no low-quality grays, no glassmorphism in light (solid clean surfaces + subtle shadows for depth).
- **Dark mode**: Retained rich, high-legibility dark (deep slate/charcoal with modern indigo accent #8b93ff range, subtle glass for depth as appropriate).
- **Icons**: Pure line (lucide-react style: thin stroke, no fill, currentColor only – exactly matching the app's current lucide usage).
- **Typography**: Inter (UI) + JetBrains Mono (content), small scale (10-14px base) for density + excellent readability.
- **Depth/elevation**: Subtle soft shadows + refined borders. No heavy/muddy glassmorphism (per brand). Focus states clear (tint + ring).
- **Sidebar/rail**: 48px pure icon-only rail (simple style, consistent with prior accepted editor-centric view). Only icons shown; labels appear exclusively via tooltip on hover/focus. No text labels rendered inside the rail itself. (User confirmed: "和之前一样走个简单的风格，就是那个编辑器，左边侧边栏不用显示文本，光显示 icon 就好了")
- **Launcher / overlays**: Clean floating command surface (white in light per VS Code, matching chrome; sections, clean items with icon/title/sub/meta).
- **Other**: Same accent across themes where possible for consistency. High WCAG contrast. Content (Monaco/text) always primary.

This scheme was iteratively validated via mocks against user feedback and brand principles. It feels native 2026 desktop utility (quiet + precise + capable) while being modern and highly legible.

## Brand
- Personality: Quiet, precise, capable. Like a high-end mechanical watch or professional measuring instrument for text — reliable, focused, satisfying to use daily. Feels native and modern (2026 desktop utility), not web SaaS or old-school 2015 flat.
- Trust signals: Excellent legibility, immediate keyboard affordances, consistent small details, content always wins.
- Avoid: 
  - 10-year-old minimal (thin everything, low presence, generic grays + dated purple).
  - Muddy glassmorphism or heavy translucency (per PRODUCT + AGENTS).
  - Low contrast or hover that reduces readability.
  - Overly decorative or "designed" for portfolio (orbs, big gradients, hero sections).
  - Turning host into review/diff product (diff is plugin).
- Differentiation: The one thing to remember — "the interface disappears; the text and my tools feel powerful and precise."

## Product goals
- Core: Fast, keyboard-first text manipulation and extension in a desktop environment. Monaco as the heart. Plugins as first-class extensions without polluting the host language.
- Success: Users feel "this is my precise text workbench" — quick to launch actions, easy to pin live tools, clean multi-pane editing, plugin UIs feel at home but host stays minimal and consistent.
- Non-goals: Rich visual editors, marketing landing vibes, full IDE bloat, arbitrary custom windows from plugins (host controls shells).

## Personas and jobs
- Primary: Technical users (devs, power users) who live in text — format, transform, compare, inspect, script. Often with global hotkeys, floating launcher, pinned actions for repeated workflows.
- Jobs to be done: 
  - Instant search/execute (launcher/palette).
  - Multi-pane editing + renderers (diff, etc. via plugins).
  - Manage and discover plugins/scripts.
  - Pinned live tools that stay in flow.
- Contexts: Desktop (macOS/Windows/Linux), mixed light/dark preference, high information density but needs breathing room so it doesn't feel cramped or flat.

## Information architecture (with layout freedom)
- **New proposed structure (adjusted from strict 4-pane + icon-only sidebar to feel more modern and less "10 years ago")**:
  - **Left rail (collapsible, 48-56px icons + optional short labels on hover/expand)**: Primary navigation (Editor, Plugins, Settings) + Pinned actions (dynamic, with small badges if active). Feels like a professional tool dock, not just tiny buttons.
  - **Top command bar**: Global status (Ready + theme), quick "Run action" (opens palette), window controls, plugin-contributed toolbar items. Minimal height, high affordance.
  - **Main canvas**: Flexible. Default: Single prominent editor pane (Monaco full focus) that can split on demand (horizontal/vertical, up to reasonable number). Panes have rich tabs (title, close, dirty state, renderer indicator). Contextual side panels can slide in for tools (e.g., regex tester, diff controls) instead of always forcing 4-grid.
  - **Floating / overlay surfaces** (Global Launcher, Command Palette, plugin tool shells): These are the "command center". Launcher gets more breathing and visual richness (sections with subtle cards, better preview for some items). Not stuck to old list style.
  - **Bottom / status area**: Lightweight info (line/col, language, active renderer). Can show pinned status or quick actions.
  - **Plugin surfaces**: Hosted in clean shells (launcher shell or dedicated tool window). Host provides consistent chrome (title, back/close, settings access). Plugin body is free within bounds (no breaking host tokens or leaking internal classes).
- Navigation: Keyboard primary (hotkeys for everything). Sidebar can expand for discoverability on larger screens or for new users.
- Content hierarchy: Text/Monaco > actions > chrome. Always.

## Design principles (updated for modern feel)
- Content first, chrome second but never invisible.
- Precision over decoration: Every pixel and transition intentional. Small type for density, but with excellent hierarchy and contrast so it doesn't feel old/flat.
- Modern desktop utility (2026): Subtle depth and presence (soft shadows, refined borders, nice focus states) without glass or skeuomorphism. Interesting but restrained typography pairing. Sharp, professional accent color that pops for actions/focus only.
- Keyboard delight: Every surface feels built for speed. Clear states, no guessing.
- Plugin respect + host consistency: Host visual language (tokens, shells, primitives) is quiet and reliable. Plugins can have their own flavor inside their body.
- Layout freedom: We can evolve beyond the initial 4-grid + tiny sidebar if it improves the "precise workbench" feeling (e.g., more flexible splitting, better use of space on large screens, launcher as a beautiful command surface).
- Accessibility & reduced motion: WCAG AA+, full keyboard, respects prefers-reduced-motion.
- Tradeoffs: Density (good for power users) vs breathing (modern, less fatiguing). We bias toward density but add controlled whitespace in overlays and cards.

## Visual language (2026 Contemporary Precision)
- **Color** (fresh, high contrast, not 10-year gray soup or ugly purple):
  - Dark (primary for focus): Rich deep slate/charcoal backgrounds. Text in high-legibility off-whites and muted grays. Accent: A sharp, modern teal-indigo (e.g. #3b82f6 or refined #6366f1) used sparingly for primary actions, selection, focus. Subtle tints for hovers/states. Excellent contrast on both themes.
  - Light (secondary): Warm off-white/cream base, soft grays. Same accent for consistency.
  - Semantic: Clear success (green), warning, error — with good foreground/background pairs.
  - No low-contrast tints. Borders have presence.
- **Typography**:
  - UI: Inter (or system) with excellent weights and tracking. Add a touch of character (e.g. slightly more geometric or a refined sans) to avoid pure 2015 Inter minimal.
  - Content: JetBrains Mono (keep as hero for code/text). Small sizes (10-14px base) for density, but with generous line-height and hierarchy so it feels premium, not cramped/old.
  - Scale and rhythm: Tight but readable. Use size + weight + color for hierarchy. Headers in launcher/settings can have a bit more presence.
- **Spacing & rhythm**: 4px base. Compact in workbench, slightly more generous in launcher/cards for modern breathing without feeling sparse. Controlled negative space.
- **Shape, radius, elevation**: Moderate, intentional rounding (not micro 2px or puffy 16px+). Subtle elevation via soft shadows + background shifts for cards, floating panels, focused panes. Borders are thin but visible and colored for structure. Focus states are strong and delightful (ring + tint + perhaps a left accent bar on lists).
- **Motion**: Short, purposeful (150-250ms). State changes, hover lift on interactive items, smooth pane splits. No decorative animation.
- **Icons**: Consistent weight, crisp. Lucide or system-style. Used meaningfully in sidebar and launcher.
- **Depth & presence**: To escape "too flat" and "10 year style" — use layered surfaces, soft but precise shadows, refined borders, and excellent focus/hover feedback. The UI should feel solid and "there" without being heavy or glass.

## Components (evolved)
- Sidebar: Icon rail (expandable on larger screens or hover for labels). Active state clear. Pinned actions grouped below.
- Launcher / Palette: Beautiful floating command surface. Sections with subtle visual separation. Items have icon, title, subtitle, meta (badges, shortcuts). Nice hover and selected states with presence. Search is prominent and clean.
- Panes: Rich tabs, flexible splitting (user can choose layout more freely). Focused pane has strong definition. Gutter and status subtle but crisp.
- Cards (plugins, settings): Clean, with good hover, subtle shadow for separation. Error states visible and informative.
- Overlays/shells for plugins: Consistent minimal chrome (title, actions, back/close). Plugin content inside gets breathing room.
- Primitives for plugins (via @hiven/plugin-ui): Buttons, lists, search, preview, toolbar — all using the new tokens so they feel native to the host.

## Accessibility, Responsive, States
- Full keyboard everywhere. Visible focus. Screen reader friendly.
- Desktop-first but resizable. Launcher adapts. Panes reflow gracefully.
- States: Loading, empty, error (clear and helpful), success (quiet), disabled, focus, selected, hover (subtle and readable), pinned/active.
- Content voice: Precise, helpful, no fluff. Consistent terminology (pane, surface, action, renderer).

## Implementation constraints
- React 19 + Tailwind + CSS vars (current setup). Tauri.
- Tokens must be exposed cleanly for host and for plugin primitives.
- Keep Monaco as-is (editable where appropriate). Do not leak editor internals into host "diff" concepts.
- Performance: Fast open for launcher/palette. Lightweight.
- Validation after changes: git status, check:architecture, build, real tauri dev for font rendering/contrast/feel. Browser mocks for proposals.
- Theme: Dark primary, light support. High DPI.

## Open questions
- (Resolved) Exact accent: using VS Code #007ACC in light for authenticity and premium pop; dark uses complementary modern indigo range.
- (Resolved) Sidebar: 48px pure icon rail (simple style). No inline text labels — icons only + tooltip.
- (Updated) Global launcher: referenced Raycast layout for item rows (left icon + title+sub inline, right type label "视图/固定/命令"), neutral gray selected rounded bar, clean top search input (no leading icon), section headers ("建议"/"结果"). Icons remain mixed (real app colorful images + pure lucide line for commands) per history "线条感" preference + discoverability. Keeps VS Code Light+ cold tokens + simple overall. Bottom hints and ranking stay.
- Other points (layout freedom, launcher delight, plugin primitives exposure) remain for future incremental work; current scheme locked as baseline.

This DESIGN.md is the contract. All future UI work, mocks, and code changes should reference it. Update when we learn more from user feedback or implementation.

(Produced following the installed "design" skill workflow: discovered evidence, noted constraints and user feedback, created structured source of truth with layout freedom explicitly allowed per latest request.)