#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  store: read('src/store.ts'),
  css: read('src/index.css'),
  host: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  systemSurfaceFrame: read('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  hostLifecycle: read('src/components/launcher/GlobalLauncherHostLifecycle.ts'),
  keyboard: read('src/components/launcher/GlobalLauncherKeyboard.ts'),
  geometry: read('src/components/launcher/GlobalLauncherGeometry.ts'),
  layout: read('src/components/launcher/GlobalLauncherLayout.ts'),
  windowLifecycle: read('src/components/launcher/GlobalLauncherWindowLifecycle.ts'),
  hotkeys: read('src/hotkeys/globalPinnedLauncher.ts'),
  overlay: read('src/components/quickEditor/QuickEditorCommandOverlay.tsx'),
  panel: read('src/components/quickEditor/QuickEditorPanel.tsx'),
  breadcrumbActions: read('src/components/quickEditor/QuickEditorBreadcrumbActions.tsx'),
  toolbar: read('src/components/quickEditor/QuickEditorToolbar.tsx'),
  detachedView: read('src/views/QuickEditorDetachedView.tsx'),
  quickEditorWindow: read('src/workspace/windowManager/quickEditorWindow.ts'),
  appTsx: read('src/App.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:quick-editor-host-surface'],
  'node scripts/test-quick-editor-host-surface.mjs',
  'package.json must expose test:quick-editor-host-surface',
)

// ── 1. globalLauncherMode is fully removed ────────────────────────────────
assert.doesNotMatch(files.store, /GlobalLauncherMode|globalLauncherMode/, 'store must not define launcher mode state')
assert.doesNotMatch(files.host, /globalLauncherMode/, 'host must not read launcher mode')
assert.doesNotMatch(files.hotkeys, /globalLauncherMode/, 'hotkeys must not read launcher mode')
assert.doesNotMatch(files.windowLifecycle, /\bmode\b/, 'resize lifecycle must not depend on launcher mode')
assert.doesNotMatch(files.appTsx, /openGlobalLauncherOverlay\('/, 'openGlobalLauncherOverlay must take no mode argument')

// ── 2. quick-editor is a host surface target ──────────────────────────────
assert.match(
  files.store,
  /LauncherHostSurfaceTarget = 'settings' \| 'plugins' \| 'system-settings' \| 'system-plugins' \| 'quick-editor'/,
  'quick-editor must be a launcher host surface target',
)
assert.doesNotMatch(files.host, /QuickEditorPanel/, 'GlobalLauncherHost must not render QuickEditorPanel directly')
assert.match(files.systemSurfaceFrame, /QuickEditorPanel/, 'system surface frame must render QuickEditorPanel')

// ── 3. entry action: focus detached window or open surface ────────────────
assert.match(files.hostActions, /openLauncherHostSurface\('quick-editor'\)/, 'entry must open the quick-editor host surface')
assert.match(files.hostActions, /isQuickEditorWindowOpen/, 'entry must check for an existing detached window')
assert.match(files.quickEditorWindow, /export async function isQuickEditorWindowOpen/, 'window manager must expose detached-window probe')
assert.match(files.quickEditorWindow, /export async function startQuickEditorWindowDrag/, 'window manager must expose detached-window drag')
assert.match(files.quickEditorWindow, /export async function startQuickEditorWindowResize/, 'window manager must expose detached-window resize')

// ── 4. escape interceptor protocol ────────────────────────────────────────
assert.ok(
  existsSync(join(root, 'src/components/launcher/launcherEscapeInterceptor.ts')),
  'launcher escape interceptor module must exist',
)
assert.match(files.hostLifecycle, /runLauncherEscapeInterceptor/, 'host escape chain must consult the interceptor')
assert.match(files.hostLifecycle, /TODO\(escape-migration\)/, 'host escape chain must carry the migration TODO')
assert.doesNotMatch(files.hostLifecycle, /quick-editor/, 'host escape chain must not carry quick editor product logic')
assert.match(files.keyboard, /hasLauncherEscapeInterceptor/, 'panel keyboard host-surface escape must yield to an active interceptor')
assert.ok(
  existsSync(join(root, 'src/components/quickEditor/useQuickEditorEscape.ts')),
  'quick editor two-stage escape hook must exist',
)
const escapeHook = read('src/components/quickEditor/useQuickEditorEscape.ts')
assert.match(escapeHook, /useLauncherEscapeInterceptor/, 'two-stage escape must register on the interceptor slot')

// ── 5. geometry/layout mode special-cases removed ──────────────────────────
assert.doesNotMatch(files.geometry, /quick-editor|QUICK_EDITOR/i, 'geometry must not special-case quick editor')
assert.doesNotMatch(files.layout, /QUICK_EDITOR/, 'layout must not re-export quick editor constants')

// ── 6. hotkey routing keyed by host surface target ─────────────────────────
assert.match(files.hotkeys, /launcherHostSurfaceTarget === 'quick-editor'/, 'hotkey routing must key off the host surface target')

// ── 7. command overlay reuses launcher pipeline ────────────────────────────
assert.match(files.overlay, /handleGlobalLauncherKeyDown/, 'overlay must use the unified launcher keyboard pipeline')
assert.match(files.overlay, /useGlobalLauncherImeComposition/, 'overlay must wire IME composition handling')
assert.match(files.overlay, /buildGlobalLauncherItems/, 'overlay must reuse the launcher item mapping')
assert.doesNotMatch(files.overlay, /Run a command\.\.\./, 'overlay placeholder must go through i18n')
assert.doesNotMatch(files.overlay, /No commands found/, 'overlay empty copy must come from the shared search frame')

// ── 8. i18n namespace ──────────────────────────────────────────────────────
assert.ok(existsSync(join(root, 'src/i18n/locales/quickEditor.ts')), 'quickEditor locale namespace must exist')
const quickEditorLocale = read('src/i18n/locales/quickEditor.ts')
assert.match(quickEditorLocale, /en:/, 'quickEditor locale must define en')
assert.match(quickEditorLocale, /zh:/, 'quickEditor locale must define zh')
assert.doesNotMatch(files.toolbar, /"Quick Editor"|'Quick Editor'|>Quick Editor</, 'toolbar title must go through i18n')

// ── 9. two-stage escape wiring in both hosts ───────────────────────────────
assert.match(files.panel, /useQuickEditorEscape/, 'panel must own the two-stage escape state machine')
assert.doesNotMatch(files.detachedView, /addEventListener\('keydown'/, 'detached view must not roll its own escape handling')
assert.doesNotMatch(files.toolbar, /closeQuickEditor\(\)/, 'toolbar must not call the removed closeQuickEditor action')

// ── 10. embedded Monaco keeps its own mouse and wheel semantics ───────────
assert.match(
  files.appTsx,
  /target\?\.closest\(['"]\.monaco-editor['"]\)[\s\S]{0,40}return/,
  'launcher wheel capture must not intercept Monaco editor scrolling',
)
assert.match(files.panel, /data-no-drag/, 'quick editor Monaco host must opt out of launcher drag handling')
assert.match(files.windowLifecycle, /\.monaco-editor/, 'launcher JS drag handling must preserve Monaco mouse events')
assert.match(files.css, /html\[data-window=['"]launcher['"]\]\s+\.global-launcher-panel\s+:is\([\s\S]{0,220}\.monaco-editor[\s\S]{0,120}-webkit-app-region:\s*no-drag/, 'standalone launcher native drag fallback must exempt Monaco editor')
assert.match(
  files.breadcrumbActions + '\n' + files.toolbar,
  /hideLauncherWindow\(\)[\s\S]{0,260}showQuickEditorWindow\(\)/,
  'detaching from standalone launcher must hide launcher before focusing the quick editor window',
)

// ── 11. detached window owns an opaque editor surface ─────────────────────
assert.match(
  files.detachedView,
  /quick-editor-detached-window/,
  'detached quick editor must render an explicit standalone window surface',
)
assert.match(
  files.css,
  /\.quick-editor-detached-window\s*\{[\s\S]{0,260}background:\s*var\(--color-background-primary\)/,
  'detached quick editor surface must paint an opaque editor background inside the transparent native window',
)
assert.match(
  files.css,
  /\.quick-editor-detached-window\[data-theme=['"]dark['"]\][\s\S]{0,80}\{/,
  'detached quick editor dark theme root must receive theme variables directly',
)
assert.match(
  files.css,
  /\.quick-editor-detached-window\[data-theme=['"]light['"]\][\s\S]{0,80}\{/,
  'detached quick editor light theme root must receive theme variables directly',
)
assert.match(
  files.css,
  /\.quick-editor-detached-window\s+:is\([\s\S]{0,240}\[data-no-drag\][\s\S]{0,120}\.monaco-editor[\s\S]{0,160}-webkit-app-region:\s*no-drag/,
  'detached quick editor controls and Monaco editor must opt out of native drag handling',
)
assert.match(
  files.detachedView,
  /startQuickEditorWindowDrag/,
  'detached quick editor chrome must use the native drag fallback',
)
assert.match(
  files.detachedView,
  /quick-editor-resize-handle/,
  'detached quick editor must render resize handles for its borderless window',
)
assert.match(
  files.detachedView,
  /startQuickEditorWindowResize/,
  'detached quick editor resize handles must call native resize dragging',
)
assert.match(
  files.detachedView,
  /registerHostLauncherProviders\(\)[\s\S]{0,160}registerBundledPluginPackages\(\)/,
  'detached quick editor must bootstrap launcher providers and bundled plugin commands for Cmd+K',
)
assert.match(
  files.detachedView,
  /loadInstalledPluginsFromStore/,
  'detached quick editor must load installed plugin commands for Cmd+K',
)
assert.doesNotMatch(
  files.css,
  /\.quick-editor-detached-window\s*\{[\s\S]{0,260}-webkit-app-region:\s*drag/,
  'detached quick editor root must not use CSS app-region drag because it swallows JS drag events',
)
assert.match(
  files.css,
  /\.quick-editor-detached-window\s*\{[\s\S]{0,260}-webkit-app-region:\s*no-drag/,
  'detached quick editor root should leave drag handling to the JS native fallback',
)
assert.match(
  read('src-tauri/src/lib.rs'),
  /launcher_default_window_size_for_window\(&window\)[\s\S]{0,160}window\.set_size\(LogicalSize::new\(quick_width,\s*quick_height\)\)/,
  'detached quick editor default size should use the same computed size as the shortcut launcher',
)

console.log('test-quick-editor-host-surface: all assertions passed')
